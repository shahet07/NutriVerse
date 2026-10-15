import os
import requests
import pandas as pd
import time
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# API Keys
SPOONACULAR_API_KEY = os.getenv("SPOONACULAR_API_KEY")
EDAMAM_APP_ID = os.getenv("EDAMAM_APP_ID")
EDAMAM_APP_KEY = os.getenv("EDAMAM_APP_KEY")

# Configuration
CUISINE = "Indian"
OUTPUT_FILE = "Dataset/processed/01_raw_scraped_recipes.csv"

# ---------------------------------------------------------------------------
# 1. SPOONACULAR SCRAPER (High Quality Nutrition & Instructions)
# ---------------------------------------------------------------------------
def scrape_spoonacular(num_recipes=100):
    print(f"\n--- Scraping {num_recipes} recipes from Spoonacular ---")
    if not SPOONACULAR_API_KEY:
        print("SPOONACULAR_API_KEY not found. Skipping Spoonacular.")
        return []

    base_url = "https://api.spoonacular.com/recipes/complexSearch"
    info_url = "https://api.spoonacular.com/recipes/{id}/information"
    
    params = {
        "apiKey": SPOONACULAR_API_KEY,
        "cuisine": CUISINE,
        "number": num_recipes,
        "addRecipeInformation": False
    }
    try:
        response = requests.get(base_url, params=params)
        response.raise_for_status()
        recipe_ids = [r["id"] for r in response.json().get("results", [])]
    except Exception as e:
        print(f"Error fetching Spoonacular IDs: {e}")
        return []

    processed_recipes = []
    for recipe_id in recipe_ids:
        try:
            print(f"Fetching Spoonacular ID: {recipe_id}...")
            url = info_url.format(id=recipe_id)
            res = requests.get(url, params={"apiKey": SPOONACULAR_API_KEY, "includeNutrition": True})
            res.raise_for_status()
            data = res.json()
            
            def get_nut(name):
                for n in data.get("nutrition", {}).get("nutrients", []):
                    if n["name"].lower() == name.lower(): return n["amount"]
                return 0.0

            ingredients = data.get("extendedIngredients", [])
            raw_ings = ", ".join([ing["original"] for ing in ingredients])
            clean_ings = ", ".join([ing["nameClean"] for ing in ingredients if ing.get("nameClean")])
            
            instructions = ""
            if data.get("analyzedInstructions"):
                steps = data["analyzedInstructions"][0].get("steps", [])
                instructions = " ".join([step["step"] for step in steps])
            elif data.get("instructions"):
                instructions = data["instructions"]

            processed_recipes.append({
                "recipe_original": data.get("title", ""),
                "final_food_name": data.get("title", ""),
                "Cuisine": CUISINE,
                "TotalTimeInMins": data.get("readyInMinutes", 0),
                "TranslatedInstructions": instructions,
                "TranslatedIngredients": raw_ings,
                "Cleaned-Ingredients": clean_ings,
                "Calories (kcal)": get_nut("Calories"),
                "Carbohydrates (g)": get_nut("Carbohydrates"),
                "Protein (g)": get_nut("Protein"),
                "Fats (g)": get_nut("Fat"),
                "Free Sugar (g)": get_nut("Sugar"),
                "Fibre (g)": get_nut("Fiber"),
                "Sodium (mg)": get_nut("Sodium"),
                "Calcium (mg)": get_nut("Calcium"),
                "Iron (mg)": get_nut("Iron"),
                "Vitamin C (mg)": get_nut("Vitamin C"),
                "Folate (µg)": get_nut("Folate"),
                "composite_score": 100.0,
                "source": "Spoonacular",
                "source_url": data.get("sourceUrl", "")
            })
            time.sleep(1)
        except Exception as e:
            print(f"Error processing Spoonacular ID {recipe_id}: {e}")

    return processed_recipes

# ---------------------------------------------------------------------------
# 2. EDAMAM SCRAPER (Excellent Nutrition, but instructions link out)
# ---------------------------------------------------------------------------
def scrape_edamam(target_recipes=100):
    print(f"\n--- Scraping up to {target_recipes} recipes from Edamam ---")
    if not EDAMAM_APP_ID or not EDAMAM_APP_KEY:
        print("EDAMAM_APP_ID or EDAMAM_APP_KEY not found. Skipping Edamam.")
        return []

    url = "https://api.edamam.com/api/recipes/v2"
    processed_recipes = []
    
    params = {
        "type": "public",
        "q": "Indian",
        "app_id": EDAMAM_APP_ID,
        "app_key": EDAMAM_APP_KEY,
        "cuisineType": "Indian",
        "random": "true"
    }

    # Edamam uses pagination (_links.next.href) to get more than 20 at a time
    next_url = url
    current_params = params

    while len(processed_recipes) < target_recipes and next_url:
        try:
            response = requests.get(next_url, params=current_params)
            response.raise_for_status()
            data = response.json()
            hits = data.get("hits", [])
            
            if not hits:
                break
                
            for hit in hits:
                if len(processed_recipes) >= target_recipes:
                    break
                    
                recipe = hit["recipe"]
                servings = recipe.get("yield", 1)
                if servings == 0: servings = 1
                
                def get_nut(code):
                    return recipe.get("totalNutrients", {}).get(code, {}).get("quantity", 0.0) / servings

                raw_ings = ", ".join(recipe.get("ingredientLines", []))
                clean_ings = ", ".join([ing.get("food", "") for ing in recipe.get("ingredients", [])])

                processed_recipes.append({
                    "recipe_original": recipe.get("label", ""),
                    "final_food_name": recipe.get("label", ""),
                    "Cuisine": CUISINE,
                    "TotalTimeInMins": recipe.get("totalTime", 0),
                    "TranslatedInstructions": "", # LEAVE BLANK FOR SCRIPT 2
                    "TranslatedIngredients": raw_ings,
                    "Cleaned-Ingredients": clean_ings,
                    "Calories (kcal)": get_nut("ENERC_KCAL"),
                    "Carbohydrates (g)": get_nut("CHOCDF"),
                    "Protein (g)": get_nut("PROCNT"),
                    "Fats (g)": get_nut("FAT"),
                    "Free Sugar (g)": get_nut("SUGAR"),
                    "Fibre (g)": get_nut("FIBTG"),
                    "Sodium (mg)": get_nut("NA"),
                    "Calcium (mg)": get_nut("CA"),
                    "Iron (mg)": get_nut("FE"),
                    "Vitamin C (mg)": get_nut("VITC"),
                    "Folate (µg)": get_nut("FOLDFE"),
                    "composite_score": 100.0,
                    "source": "Edamam",
                    "source_url": recipe.get("url", "") # SAVE URL FOR SCRIPT 2
                })
                
            print(f"Fetched {len(processed_recipes)} Edamam recipes so far...")
            
            # Get next page URL
            next_url = data.get("_links", {}).get("next", {}).get("href")
            current_params = None # The next_url already contains the parameters
            
            # Rate limit protection (10 calls/min = 1 call every 6 seconds)
            # Since each call returns 20 recipes, we get 200 recipes per minute.
            print("Waiting 6 seconds to respect Edamam rate limit (10 calls/min)...")
            time.sleep(6.1) 
            
        except Exception as e:
            print(f"Error fetching Edamam recipes: {e}")
            break

    return processed_recipes

# ---------------------------------------------------------------------------
# MAIN EXECUTION & DEDUPLICATION
# ---------------------------------------------------------------------------
def main():
    all_recipes = []
    
    # 1. Scrape from APIs (Adjust numbers as needed)
    # all_recipes.extend(scrape_spoonacular(num_recipes=100))
    all_recipes.extend(scrape_edamam(target_recipes=2000)) # Fetch 2000 from Edamam
    
    if not all_recipes:
        print("\nNo recipes were scraped. Check your API keys.")
        return

    # 2. Convert to DataFrame
    df = pd.DataFrame(all_recipes)
    
    # 3. Deduplicate based on recipe name (case-insensitive)
    print(f"\nTotal recipes scraped: {len(df)}")
    df['name_lower'] = df['final_food_name'].str.lower()
    df = df.drop_duplicates(subset=['name_lower'], keep='first')
    df = df.drop(columns=['name_lower'])
    print(f"Total unique recipes after deduplication: {len(df)}")
    
    # 4. Save to CSV
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"\nSuccessfully saved {len(df)} unique recipes to {OUTPUT_FILE}")
    print("Next Step: Run scripts/02_scrape_instructions.py to fill in missing instructions!")

if __name__ == "__main__":
    main()
