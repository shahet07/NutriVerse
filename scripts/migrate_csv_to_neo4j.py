"""
Neo4j Migration Script — Ingest Final_unified_dataset.csv into the graph.

Schema:
  Nodes:  Recipe (725), Ingredient (~395), Cuisine (54), ImageClass (148)
  Rels:   CONTAINS, BELONGS_TO, MAPS_TO

Usage:
  .\.Nutri\Scripts\python.exe scripts\migrate_csv_to_neo4j.py
"""

import os
import uuid
import json
import re
import pandas as pd
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

URI = os.getenv("NEO4J_URI")
AUTH = (os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD"))

CSV_PATH = "Dataset/processed/Final_unified_dataset.csv"
CLASS_NAMES_PATH = "class_names.json"




def clean_ingredient(name: str) -> str:
    """Normalize an ingredient name for deduplication."""
    name = name.strip().lower()
    # Remove stray single characters like ')' or '('
    if len(name) <= 1 and not name.isalpha():
        return ""
    # Remove leading/trailing parentheses artifacts
    name = re.sub(r'^\)+|\(+$', '', name).strip()
    return name


def safe_float(val):
    """Convert a value to float, returning None for NaN."""
    if pd.isna(val):
        return None
    return float(val)




def connect():
    driver = GraphDatabase.driver(URI, auth=AUTH)
    driver.verify_connectivity()
    print(f"Connected to Neo4j at {URI}")
    return driver




def clear_database(driver):
    print("\n[1/8] Clearing existing data...")
    with driver.session() as session:
        result = session.run("MATCH (n) RETURN count(n) AS count")
        count = result.single()["count"]
        if count > 0:
            print(f"  Deleting {count} existing nodes...")
            session.run("MATCH (n) DETACH DELETE n")
            print("  Database cleared.")
        else:
            print("  Database already empty.")




def create_constraints(driver):
    print("\n[2/8] Creating constraints & indexes...")
    with driver.session() as session:
        constraints = [
            "CREATE CONSTRAINT recipe_id IF NOT EXISTS FOR (r:Recipe) REQUIRE r.id IS UNIQUE",
            "CREATE CONSTRAINT ingredient_name IF NOT EXISTS FOR (i:Ingredient) REQUIRE i.name IS UNIQUE",
            "CREATE CONSTRAINT cuisine_name IF NOT EXISTS FOR (c:Cuisine) REQUIRE c.name IS UNIQUE",
            "CREATE CONSTRAINT imageclass_name IF NOT EXISTS FOR (ic:ImageClass) REQUIRE ic.name IS UNIQUE",
        ]
        for c in constraints:
            session.run(c)
            print(f"  [OK] {c.split('REQUIRE')[0].strip()}")

        # Full-text index for recipe name search
        try:
            session.run(
                "CREATE FULLTEXT INDEX recipe_name_fulltext IF NOT EXISTS "
                "FOR (r:Recipe) ON EACH [r.name, r.food_name]"
            )
            print("  [OK] Full-text index on Recipe.name, Recipe.food_name")
        except Exception as e:
            print(f"  [WARN] Full-text index: {e}")



def load_cuisines(driver, df):
    print("\n[3/8] Loading Cuisine nodes...")
    cuisines = df['Cuisine'].unique().tolist()
    with driver.session() as session:
        session.run(
            "UNWIND $cuisines AS name MERGE (c:Cuisine {name: name})",
            cuisines=cuisines
        )
    print(f"  [OK] {len(cuisines)} Cuisine nodes created.")
    return cuisines




def load_recipes(driver, df):
    print("\n[4/8] Loading Recipe nodes...")
    recipes = []
    for _, row in df.iterrows():
        recipe = {
            "id": str(uuid.uuid4()),
            "name": str(row['recipe_original']),
            "food_name": str(row['final_food_name']),
            "prep_time_mins": int(row['TotalTimeInMins']),
            "instructions": str(row['TranslatedInstructions']),
            "raw_ingredients": str(row['TranslatedIngredients']),
            "calories": safe_float(row['Calories (kcal)']),
            "carbohydrates": safe_float(row['Carbohydrates (g)']),
            "protein": safe_float(row['Protein (g)']),
            "fats": safe_float(row['Fats (g)']),
            "free_sugar": safe_float(row['Free Sugar (g)']),
            "fibre": safe_float(row['Fibre (g)']),
            "sodium": safe_float(row['Sodium (mg)']),
            "calcium": safe_float(row['Calcium (mg)']),
            "iron": safe_float(row['Iron (mg)']),
            "vitamin_c": safe_float(row['Vitamin C (mg)']),
            "folate": safe_float(row['Folate (µg)']),
            "composite_score": safe_float(row['composite_score']),
        }
        recipes.append(recipe)

    BATCH_SIZE = 100
    with driver.session() as session:
        for i in range(0, len(recipes), BATCH_SIZE):
            batch = recipes[i:i + BATCH_SIZE]
            session.run("""
                UNWIND $recipes AS r
                CREATE (n:Recipe {
                    id: r.id,
                    name: r.name,
                    food_name: r.food_name,
                    prep_time_mins: r.prep_time_mins,
                    instructions: r.instructions,
                    raw_ingredients: r.raw_ingredients,
                    calories: r.calories,
                    carbohydrates: r.carbohydrates,
                    protein: r.protein,
                    fats: r.fats,
                    free_sugar: r.free_sugar,
                    fibre: r.fibre,
                    sodium: r.sodium,
                    calcium: r.calcium,
                    iron: r.iron,
                    vitamin_c: r.vitamin_c,
                    folate: r.folate,
                    composite_score: r.composite_score
                })
            """, recipes=batch)
            print(f"  Batch {i // BATCH_SIZE + 1}: {len(batch)} recipes")

    print(f"  [OK] {len(recipes)} Recipe nodes created.")
    return recipes




def load_ingredients(driver, df):
    print("\n[5/8] Loading Ingredient nodes & CONTAINS relationships...")

    all_ingredients = set()
    recipe_ingredients = {}  # recipe_original -> list of cleaned ingredients

    for _, row in df.iterrows():
        raw = str(row['Cleaned-Ingredients'])
        ings = []
        for part in raw.split(','):
            cleaned = clean_ingredient(part)
            if cleaned:
                ings.append(cleaned)
                all_ingredients.add(cleaned)
        recipe_ingredients[str(row['recipe_original'])] = ings

    # Create all ingredient nodes
    with driver.session() as session:
        ing_list = list(all_ingredients)
        BATCH_SIZE = 100
        for i in range(0, len(ing_list), BATCH_SIZE):
            batch = ing_list[i:i + BATCH_SIZE]
            session.run(
                "UNWIND $ingredients AS name MERGE (i:Ingredient {name: name})",
                ingredients=batch
            )
    print(f"  [OK] {len(all_ingredients)} Ingredient nodes created.")

    # Create CONTAINS relationships
    with driver.session() as session:
        rel_count = 0
        for recipe_name, ings in recipe_ingredients.items():
            if ings:
                session.run("""
                    MATCH (r:Recipe {name: $recipe_name})
                    UNWIND $ingredients AS ing_name
                    MATCH (i:Ingredient {name: ing_name})
                    MERGE (r)-[:CONTAINS]->(i)
                """, recipe_name=recipe_name, ingredients=ings)
                rel_count += len(ings)

    print(f"  [OK] ~{rel_count} CONTAINS relationships created.")
    return all_ingredients




def create_cuisine_relationships(driver, df):
    print("\n[6/8] Creating BELONGS_TO relationships...")
    with driver.session() as session:
        pairs = df[['recipe_original', 'Cuisine']].drop_duplicates().values.tolist()
        BATCH_SIZE = 100
        for i in range(0, len(pairs), BATCH_SIZE):
            batch = [{"recipe": p[0], "cuisine": p[1]} for p in pairs[i:i + BATCH_SIZE]]
            session.run("""
                UNWIND $pairs AS p
                MATCH (r:Recipe {name: p.recipe})
                MATCH (c:Cuisine {name: p.cuisine})
                MERGE (r)-[:BELONGS_TO]->(c)
            """, pairs=batch)

    print(f"  [OK] {len(pairs)} BELONGS_TO relationships created.")




def load_image_classes(driver):
    print("\n[7/8] Loading ImageClass nodes...")
    with open(CLASS_NAMES_PATH, "r") as f:
        classes = json.load(f)

    with driver.session() as session:
        session.run(
            "UNWIND $classes AS name MERGE (ic:ImageClass {name: name})",
            classes=classes
        )
    print(f"  [OK] {len(classes)} ImageClass nodes created.")
    return classes




def create_image_mappings(driver, image_classes):
    print("\n[8/8] Creating MAPS_TO relationships (ImageClass → Recipe)...")

    with driver.session() as session:
        result = session.run("MATCH (r:Recipe) RETURN r.food_name AS food_name")
        food_names = [record["food_name"].lower().strip() for record in result]

        mapped = 0
        for cls in image_classes:
            cls_lower = cls.lower().strip()
            # Find recipes where food_name contains the image class name
            for fname in food_names:
                if cls_lower in fname or fname in cls_lower:
                    session.run("""
                        MATCH (ic:ImageClass {name: $class_name})
                        MATCH (r:Recipe) WHERE toLower(r.food_name) CONTAINS $class_lower
                        MERGE (ic)-[:MAPS_TO]->(r)
                    """, class_name=cls, class_lower=cls_lower)
                    mapped += 1
                    break

    print(f"  [OK] {mapped} MAPS_TO relationships created.")




def print_summary(driver):
    print("\n" + "=" * 60)
    print("MIGRATION SUMMARY")
    print("=" * 60)
    with driver.session() as session:
        queries = {
            "Recipe nodes": "MATCH (r:Recipe) RETURN count(r) AS c",
            "Ingredient nodes": "MATCH (i:Ingredient) RETURN count(i) AS c",
            "Cuisine nodes": "MATCH (c:Cuisine) RETURN count(c) AS c",
            "ImageClass nodes": "MATCH (ic:ImageClass) RETURN count(ic) AS c",
            "CONTAINS rels": "MATCH ()-[r:CONTAINS]->() RETURN count(r) AS c",
            "BELONGS_TO rels": "MATCH ()-[r:BELONGS_TO]->() RETURN count(r) AS c",
            "MAPS_TO rels": "MATCH ()-[r:MAPS_TO]->() RETURN count(r) AS c",
        }
        for label, query in queries.items():
            result = session.run(query)
            count = result.single()["c"]
            print(f"  {label}: {count}")

    # Sample verification
    print("\n--- Sample Recipe with all relationships ---")
    with driver.session() as session:
        result = session.run("""
            MATCH (r:Recipe)-[:CONTAINS]->(i:Ingredient)
            WITH r, collect(i.name) AS ingredients
            MATCH (r)-[:BELONGS_TO]->(c:Cuisine)
            RETURN r.name AS recipe, r.calories AS cal, r.protein AS protein,
                   c.name AS cuisine, ingredients
            LIMIT 3
        """)
        for record in result:
            print(f"\n  {record['recipe']}")
            print(f"     Cuisine: {record['cuisine']}")
            print(f"     Calories: {record['cal']}, Protein: {record['protein']}g")
            print(f"     Ingredients: {', '.join(record['ingredients'][:8])}...")




def main():
    print("=" * 60)
    print("NutriSense-AI: CSV → Neo4j Migration")
    print("=" * 60)

    # Load data
    df = pd.read_csv(CSV_PATH)
    print(f"Loaded {len(df)} rows from {CSV_PATH}")

    # Deduplicate (remove exact duplicate rows)
    before = len(df)
    df = df.drop_duplicates(subset=['recipe_original'], keep='first')
    after = len(df)
    if before != after:
        print(f"  Removed {before - after} duplicate rows. Now: {after} rows.")

    # Connect
    driver = connect()

    try:
        # Execute migration steps
        clear_database(driver)
        create_constraints(driver)
        load_cuisines(driver, df)
        load_recipes(driver, df)
        load_ingredients(driver, df)
        create_cuisine_relationships(driver, df)
        image_classes = load_image_classes(driver)
        create_image_mappings(driver, image_classes)
        print_summary(driver)

        print("\n[SUCCESS] MIGRATION COMPLETE!")
    except Exception as e:
        print(f"\n[ERROR] MIGRATION FAILED: {e}")
        raise
    finally:
        driver.close()


if __name__ == "__main__":
    main()
