"""
Neo4j Migration Script v2 â€” Dual Food Cluster Architecture.

Implements Phase 2.5 of the NutriSense-AI roadmap.

Cluster A â€” Home-Cooked Recipes:
    Source : Dataset/processed/Final_unified_dataset.csv
    Nodes  : Recipe (~751), Ingredient (~395), Cuisine (54), ImageClass (148)
    Rels   : CONTAINS, BELONGS_TO, MAPS_TO

Cluster B â€” Packaged Food Products:
    Source : Dataset/processed/products_clean.csv  (filtered to ~6,432 quality rows)
    Nodes  : FoodProduct, Brand, Category
    Rels   : MADE_BY, IN_CATEGORY, CONTAINS (shared Ingredient pool)

Cross-Cluster:
    AllergenTag nodes (7 allergens) linked via IS_ALLERGEN from shared Ingredient nodes.
    Both Recipe and FoodProduct share the same Ingredient node pool.

Migration steps (12 total):
    1.  Connect to Neo4j
    2.  Clear all existing data
    3.  Create constraints & indexes
    4.  Load AllergenTag nodes
    5.  Load Cuisine nodes (Cluster A)
    6.  Load Recipe nodes (Cluster A)
    7.  Load Ingredient nodes + CONTAINS rels (Cluster A)
    8.  Create BELONGS_TO relationships (Cluster A)
    9.  Load ImageClass nodes + MAPS_TO relationships (Cluster A)
    10. Load Category & Brand nodes (Cluster B)
    11. Load FoodProduct nodes + MADE_BY + IN_CATEGORY rels (Cluster B)
    12. Load Ingredient nodes + CONTAINS rels from product ingredients (Cluster B)
    13. Wire IS_ALLERGEN relationships (cross-cluster, shared Ingredient pool)
    14. Verify & print summary

Usage:
    .Nutri\\Scripts\\python.exe scripts\\migrate_v2_dual_cluster.py

Requirements:
    pip install neo4j pandas rapidfuzz python-dotenv
"""

import os
import re
import uuid
import json

import pandas as pd
from dotenv import load_dotenv
from neo4j import GraphDatabase
from rapidfuzz import fuzz

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# CONFIGURATION
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

load_dotenv()

URI   = os.getenv("NEO4J_URI")
AUTH  = (os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD"))

RECIPE_CSV_PATH  = "Dataset/processed/Final_unified_dataset.csv"
PRODUCT_CSV_PATH = "Dataset/processed/products_clean.csv"
CLASS_NAMES_PATH = "scripts/class_names.json"

BATCH_SIZE = 200   # Rows per Cypher UNWIND batch

# Allergen keyword taxonomy  (ingredient substring â†’ allergen label)
ALLERGEN_MAP: dict[str, list[str]] = {
    "Dairy":     ["milk", "cheese", "butter", "cream", "ghee", "paneer", "curd",
                  "yogurt", "yoghurt", "lactose", "whey", "lassi", "khoya", "mawa",
                  "condensed milk", "evaporated milk"],
    "Nuts":      ["almond", "cashew", "walnut", "peanut", "pistachio", "hazelnut",
                  "pecan", "macadamia", "pine nut", "groundnut", "nut"],
    "Gluten":    ["wheat", "flour", "bread", "barley", "rye", "semolina", "maida",
                  "atta", "pasta", "noodle", "cracker", "biscuit", "oat"],
    "Soy":       ["soy", "soya", "tofu", "edamame", "tempeh", "miso"],
    "Eggs":      ["egg", "eggs", "mayonnaise", "mayo", "meringue", "albumin"],
    "Shellfish": ["shrimp", "prawn", "crab", "lobster", "oyster", "shellfish",
                  "clam", "mussel", "scallop"],
    "Sesame":    ["sesame", "tahini", "til", "gingelly"],
}

# pnns_groups_1 values to treat as "Unknown" category
UNKNOWN_CATEGORIES = {"unknown", "Unknown", ""}

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# HELPERS
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def safe_float(val) -> float | None:
    """Convert pandas value to float; return None for NaN."""
    if pd.isna(val):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def safe_int(val) -> int | None:
    """Convert pandas value to int; return None for NaN."""
    if pd.isna(val):
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def safe_str(val, default: str = "") -> str:
    """Convert pandas value to str; return default for NaN."""
    if pd.isna(val):
        return default
    return str(val).strip()


def clean_ingredient(name: str) -> str:
    """Normalize an ingredient string for deduplication."""
    name = name.strip().lower()
    # Drop stray single non-alpha characters
    if len(name) <= 1 and not name.isalpha():
        return ""
    # Strip leading/trailing parenthesis artifacts
    name = re.sub(r"^\)+|\(+$", "", name).strip()
    # Remove quantity/measure prefixes like "1 cup ", "2 tsp "
    name = re.sub(r"^\d+[\d\s/\.]*(?:g|kg|ml|l|cup|tsp|tbsp|oz|lb|piece|pcs)?\s+", "", name)
    return name


def detect_allergens(ingredient_name: str) -> list[str]:
    """Return list of allergen labels matching this ingredient name."""
    lower = ingredient_name.lower()
    detected = []
    for allergen, keywords in ALLERGEN_MAP.items():
        if any(kw in lower for kw in keywords):
            detected.append(allergen)
    return detected


def derive_product_category(row) -> str:
    """Determine best category label for a product row."""
    pnns1 = safe_str(row.get("pnns_groups_1", ""))
    if pnns1 and pnns1.lower() not in UNKNOWN_CATEGORIES:
        return pnns1
    # Fall back to first entry in categories_en
    cats = safe_str(row.get("categories_en", ""))
    if cats:
        first = cats.split(",")[0].strip()
        if first:
            return first
    return "Uncategorized"


def split_product_ingredients(raw: str) -> list[str]:
    """Split an ingredients_text string from Open Food Facts into a list."""
    if not raw:
        return []
    # OOF uses commas and semicolons as separators; also strip sub-lists in parens
    raw = re.sub(r"\([^)]*\)", "", raw)          # Remove parenthetical sub-lists
    raw = re.sub(r"\[[^\]]*\]", "", raw)          # Remove bracketed sub-lists
    parts = re.split(r"[,;]", raw)
    cleaned = []
    for p in parts:
        c = clean_ingredient(p)
        if c and len(c) > 2:                      # Skip token noise
            cleaned.append(c)
    return list(dict.fromkeys(cleaned))           # Deduplicate while preserving order


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 0: CONNECT
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def connect():
    driver = GraphDatabase.driver(URI, auth=AUTH)
    driver.verify_connectivity()
    print(f"  Connected to Neo4j at {URI}")
    return driver


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 1: CLEAR ALL EXISTING DATA
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def clear_database(driver):
    print("\n[Step 1] Clearing all existing data...")
    with driver.session() as session:
        result = session.run("MATCH (n) RETURN count(n) AS count")
        count = result.single()["count"]
        if count > 0:
            print(f"  Deleting {count:,} existing nodes (and all relationships)...")
            # Delete in batches to avoid memory spikes on large graphs
            deleted = 0
            while True:
                result = session.run(
                    "MATCH (n) WITH n LIMIT 10000 DETACH DELETE n RETURN count(n) AS c"
                )
                batch_deleted = result.single()["c"]
                deleted += batch_deleted
                if batch_deleted == 0:
                    break
            print(f"  Deleted {deleted:,} nodes. Database is now empty.")
        else:
            print("  Database is already empty.")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 2: CONSTRAINTS & INDEXES
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def create_constraints(driver):
    print("\n[Step 2] Creating constraints & indexes...")
    with driver.session() as session:

        # --- Unique constraints ---
        constraints = [
            # Cluster A
            ("Recipe",       "id",   "recipe_id"),
            ("Ingredient",   "name", "ingredient_name"),
            ("Cuisine",      "name", "cuisine_name"),
            ("ImageClass",   "name", "imageclass_name"),
            # Cluster B
            ("FoodProduct",  "id",   "foodproduct_id"),
            ("Brand",        "name", "brand_name"),
            ("Category",     "name", "category_name"),
            # Cross-cluster
            ("AllergenTag",  "name", "allergentag_name"),
        ]
        for label, prop, constraint_name in constraints:
            cypher = (
                f"CREATE CONSTRAINT {constraint_name} IF NOT EXISTS "
                f"FOR (n:{label}) REQUIRE n.{prop} IS UNIQUE"
            )
            session.run(cypher)
            print(f"  [OK] UNIQUE {label}.{prop}")

        # --- Full-text indexes ---
        fulltext = [
            ("recipe_name_fulltext",
             "FOR (r:Recipe) ON EACH [r.name, r.food_name]"),
            ("product_name_fulltext",
             "FOR (p:FoodProduct) ON EACH [p.name, p.generic_name]"),
        ]
        for index_name, body in fulltext:
            try:
                session.run(
                    f"CREATE FULLTEXT INDEX {index_name} IF NOT EXISTS {body}"
                )
                print(f"  [OK] Full-text index: {index_name}")
            except Exception as exc:
                print(f"  [WARN] Full-text index {index_name}: {exc}")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 3: LOAD ALLERGENTAG NODES (cross-cluster, created first)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_allergen_tags(driver):
    print("\n[Step 3] Loading AllergenTag nodes...")
    allergens = list(ALLERGEN_MAP.keys())
    with driver.session() as session:
        session.run(
            "UNWIND $tags AS name MERGE (:AllergenTag {name: name})",
            tags=allergens,
        )
    print(f"  [OK] {len(allergens)} AllergenTag nodes: {', '.join(allergens)}")
    return allergens


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 4: LOAD CUISINE NODES  (Cluster A)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_cuisines(driver, df: pd.DataFrame):
    print("\n[Step 4] Loading Cuisine nodes (Cluster A)...")
    cuisines = [c for c in df["Cuisine"].dropna().unique().tolist()]
    with driver.session() as session:
        session.run(
            "UNWIND $cuisines AS name MERGE (:Cuisine {name: name})",
            cuisines=cuisines,
        )
    print(f"  [OK] {len(cuisines)} Cuisine nodes.")
    return cuisines


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 5: LOAD RECIPE NODES  (Cluster A)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_recipes(driver, df: pd.DataFrame) -> list[dict]:
    print("\n[Step 5] Loading Recipe nodes (Cluster A)...")
    records = []
    for _, row in df.iterrows():
        records.append({
            "id":             str(uuid.uuid4()),
            "name":           safe_str(row["recipe_original"]),
            "food_name":      safe_str(row["final_food_name"]),
            "best_match_clean": safe_str(row["best_match_clean"]),
            "prep_time_mins": safe_int(row["TotalTimeInMins"]),
            "cuisine":        safe_str(row["Cuisine"]),
            "instructions":   safe_str(row["TranslatedInstructions"]),
            "raw_ingredients": safe_str(row["TranslatedIngredients"]),
            "calories":       safe_float(row["Calories (kcal)"]),
            "carbohydrates":  safe_float(row["Carbohydrates (g)"]),
            "protein":        safe_float(row["Protein (g)"]),
            "fats":           safe_float(row["Fats (g)"]),
            "free_sugar":     safe_float(row["Free Sugar (g)"]),
            "fibre":          safe_float(row["Fibre (g)"]),
            "sodium":         safe_float(row["Sodium (mg)"]),
            "calcium":        safe_float(row["Calcium (mg)"]),
            "iron":           safe_float(row["Iron (mg)"]),
            "vitamin_c":      safe_float(row["Vitamin C (mg)"]),
            "folate":         safe_float(row["Folate (Âµg)"]),
            "composite_score": safe_float(row["composite_score"]),
        })

    with driver.session() as session:
        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i : i + BATCH_SIZE]
            session.run("""
                UNWIND $recipes AS r
                CREATE (n:Recipe {
                    id:               r.id,
                    name:             r.name,
                    food_name:        r.food_name,
                    best_match_clean: r.best_match_clean,
                    prep_time_mins:   r.prep_time_mins,
                    instructions:     r.instructions,
                    raw_ingredients:  r.raw_ingredients,
                    calories:         r.calories,
                    carbohydrates:    r.carbohydrates,
                    protein:          r.protein,
                    fats:             r.fats,
                    free_sugar:       r.free_sugar,
                    fibre:            r.fibre,
                    sodium:           r.sodium,
                    calcium:          r.calcium,
                    iron:             r.iron,
                    vitamin_c:        r.vitamin_c,
                    folate:           r.folate,
                    composite_score:  r.composite_score
                })
            """, recipes=batch)
            print(f"  Batch {i // BATCH_SIZE + 1}: +{len(batch)} recipes")

    print(f"  [OK] {len(records)} Recipe nodes created.")
    return records


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 6: LOAD INGREDIENT NODES + CONTAINS rels  (Cluster A)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_recipe_ingredients(driver, df: pd.DataFrame) -> set[str]:
    print("\n[Step 6] Loading Ingredient nodes + CONTAINS rels (Cluster A)...")

    # Collect every unique cleaned ingredient, keyed per recipe
    all_ingredients: set[str] = set()
    recipe_ing_map: dict[str, list[str]] = {}   # recipe name â†’ ingredient list

    for _, row in df.iterrows():
        raw = safe_str(row["Cleaned-Ingredients"])
        ings: list[str] = []
        for part in raw.split(","):
            c = clean_ingredient(part)
            if c:
                ings.append(c)
                all_ingredients.add(c)
        recipe_ing_map[safe_str(row["recipe_original"])] = ings

    # Upsert all ingredient nodes
    ing_list = list(all_ingredients)
    with driver.session() as session:
        for i in range(0, len(ing_list), BATCH_SIZE):
            batch = ing_list[i : i + BATCH_SIZE]
            session.run(
                "UNWIND $names AS name MERGE (:Ingredient {name: name})",
                names=batch,
            )
    print(f"  [OK] {len(all_ingredients)} Ingredient nodes (merged).")

    # Create CONTAINS relationships
    with driver.session() as session:
        rel_count = 0
        pairs = [
            {"recipe": name, "ings": ings}
            for name, ings in recipe_ing_map.items()
            if ings
        ]
        for i in range(0, len(pairs), BATCH_SIZE):
            batch = pairs[i : i + BATCH_SIZE]
            session.run("""
                UNWIND $pairs AS p
                MATCH (r:Recipe {name: p.recipe})
                UNWIND p.ings AS ing_name
                MATCH (i:Ingredient {name: ing_name})
                MERGE (r)-[:CONTAINS]->(i)
            """, pairs=batch)
            rel_count += sum(len(p["ings"]) for p in batch)

    print(f"  [OK] ~{rel_count} CONTAINS rels (Recipe â†’ Ingredient).")
    return all_ingredients


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 7: BELONGS_TO RELATIONSHIPS  (Cluster A)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def create_cuisine_relationships(driver, df: pd.DataFrame):
    print("\n[Step 7] Creating BELONGS_TO relationships (Cluster A)...")
    pairs = (
        df[["recipe_original", "Cuisine"]]
        .drop_duplicates()
        .dropna()
        .values.tolist()
    )
    with driver.session() as session:
        for i in range(0, len(pairs), BATCH_SIZE):
            batch = [{"recipe": p[0], "cuisine": p[1]} for p in pairs[i : i + BATCH_SIZE]]
            session.run("""
                UNWIND $pairs AS p
                MATCH (r:Recipe {name: p.recipe})
                MATCH (c:Cuisine {name: p.cuisine})
                MERGE (r)-[:BELONGS_TO]->(c)
            """, pairs=batch)
    print(f"  [OK] {len(pairs)} BELONGS_TO rels.")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 8: IMAGE CLASS NODES + MAPS_TO RELATIONSHIPS  (Cluster A)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_image_classes(driver) -> list[str]:
    print("\n[Step 8] Loading ImageClass nodes + MAPS_TO rels (Cluster A)...")
    with open(CLASS_NAMES_PATH, "r") as fh:
        classes: list[str] = json.load(fh)

    with driver.session() as session:
        session.run(
            "UNWIND $classes AS name MERGE (:ImageClass {name: name})",
            classes=classes,
        )
    print(f"  [OK] {len(classes)} ImageClass nodes created.")
    return classes


def create_image_mappings(driver, image_classes: list[str]):
    with driver.session() as session:
        result = session.run("MATCH (r:Recipe) RETURN r.best_match_clean AS bmc, r.food_name AS fn")
        food_data = [(rec["bmc"] or "", rec["fn"] or "") for rec in result]

    mapped = 0
    with driver.session() as session:
        for cls in image_classes:
            cls_lower = cls.lower().strip()
            # Try best_match_clean containment first, then fuzzy fallback
            matched = False
            for bmc, fn in food_data:
                if cls_lower in bmc.lower() or bmc.lower() in cls_lower:
                    session.run("""
                        MATCH (ic:ImageClass {name: $cls})
                        MATCH (r:Recipe) WHERE toLower(r.best_match_clean) CONTAINS $cls_lower
                           OR $cls_lower CONTAINS toLower(r.best_match_clean)
                        MERGE (ic)-[:MAPS_TO]->(r)
                    """, cls=cls, cls_lower=cls_lower)
                    mapped += 1
                    matched = True
                    break
            if not matched:
                # Fuzzy fallback: try food_name
                for bmc, fn in food_data:
                    if fuzz.token_set_ratio(cls_lower, fn.lower()) >= 80:
                        session.run("""
                            MATCH (ic:ImageClass {name: $cls})
                            MATCH (r:Recipe {food_name: $fn})
                            MERGE (ic)-[:MAPS_TO]->(r)
                        """, cls=cls, fn=fn)
                        mapped += 1
                        break

    print(f"  [OK] {mapped} MAPS_TO rels (ImageClass â†’ Recipe).")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 9: LOAD CATEGORY & BRAND NODES  (Cluster B)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_categories_and_brands(driver, df_products: pd.DataFrame):
    print("\n[Step 9] Loading Category & Brand nodes (Cluster B)...")

    categories = set()
    brands = set()
    for _, row in df_products.iterrows():
        cat = derive_product_category(row)
        categories.add(cat)
        brand = safe_str(row.get("brands", ""))
        if brand:
            brands.add(brand)

    with driver.session() as session:
        cat_list = list(categories)
        for i in range(0, len(cat_list), BATCH_SIZE):
            batch = cat_list[i : i + BATCH_SIZE]
            session.run(
                "UNWIND $cats AS name MERGE (:Category {name: name})",
                cats=batch,
            )

        brand_list = list(brands)
        for i in range(0, len(brand_list), BATCH_SIZE):
            batch = brand_list[i : i + BATCH_SIZE]
            session.run(
                "UNWIND $brands AS name MERGE (:Brand {name: name})",
                brands=batch,
            )

    print(f"  [OK] {len(categories)} Category nodes, {len(brands)} Brand nodes.")
    return categories, brands


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 10: LOAD FOODPRODUCT NODES + MADE_BY + IN_CATEGORY  (Cluster B)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_food_products(driver, df_products: pd.DataFrame) -> list[dict]:
    print("\n[Step 10] Loading FoodProduct nodes + MADE_BY + IN_CATEGORY rels (Cluster B)...")

    records = []
    for _, row in df_products.iterrows():
        brand = safe_str(row.get("brands", ""))
        category = derive_product_category(row)

        records.append({
            "id":                  safe_str(row["barcode"]) or str(uuid.uuid4()),
            "name":                safe_str(row["product_name"]),
            "generic_name":        safe_str(row.get("generic_name", "")),
            "brand":               brand,
            "category":            category,
            "quantity":            safe_str(row.get("quantity", "")),
            "serving_size":        safe_str(row.get("serving_size", "")),
            "serving_quantity":    safe_float(row.get("serving_quantity")),
            "nova_group":          safe_int(row.get("nova_group")),
            "nutriscore_grade":    safe_str(row.get("nutriscore_grade", "")),
            # Nutrition per 100g
            "calories_100g":       safe_float(row["calories_100g"]),
            "fat_100g":            safe_float(row["fat_g_100g"]),
            "saturated_fat_100g":  safe_float(row.get("saturated_fat_g_100g")),
            "trans_fat_100g":      safe_float(row.get("trans_fat_g_100g")),
            "carbohydrates_100g":  safe_float(row["carbohydrates_g_100g"]),
            "sugars_100g":         safe_float(row.get("sugars_g_100g")),
            "fiber_100g":          safe_float(row.get("fiber_g_100g")),
            "proteins_100g":       safe_float(row["proteins_g_100g"]),
            "sodium_100g":         safe_float(row.get("sodium_mg_100g")),
            "calcium_100g":        safe_float(row.get("calcium_mg_100g")),
            "iron_100g":           safe_float(row.get("iron_mg_100g")),
            "vitamin_c_100g":      safe_float(row.get("vitamin_c_mg_100g")),
            "folate_100g":         safe_float(row.get("folate_ug_100g")),
            "image_url":           safe_str(row.get("image_url", "")),
        })

    # Insert FoodProduct nodes in batches
    with driver.session() as session:
        for i in range(0, len(records), BATCH_SIZE):
            batch = records[i : i + BATCH_SIZE]
            session.run("""
                UNWIND $products AS p
                CREATE (n:FoodProduct {
                    id:               p.id,
                    name:             p.name,
                    generic_name:     p.generic_name,
                    brand:            p.brand,
                    category:         p.category,
                    quantity:         p.quantity,
                    serving_size:     p.serving_size,
                    serving_quantity: p.serving_quantity,
                    nova_group:       p.nova_group,
                    nutriscore_grade: p.nutriscore_grade,
                    calories_100g:    p.calories_100g,
                    fat_100g:         p.fat_100g,
                    saturated_fat_100g: p.saturated_fat_100g,
                    trans_fat_100g:   p.trans_fat_100g,
                    carbohydrates_100g: p.carbohydrates_100g,
                    sugars_100g:      p.sugars_100g,
                    fiber_100g:       p.fiber_100g,
                    proteins_100g:    p.proteins_100g,
                    sodium_100g:      p.sodium_100g,
                    calcium_100g:     p.calcium_100g,
                    iron_100g:        p.iron_100g,
                    vitamin_c_100g:   p.vitamin_c_100g,
                    folate_100g:      p.folate_100g,
                    image_url:        p.image_url
                })
            """, products=batch)
            print(f"  Batch {i // BATCH_SIZE + 1}: +{len(batch)} products")

    # MADE_BY relationships (skip if brand is empty)
    brand_pairs = [{"id": r["id"], "brand": r["brand"]} for r in records if r["brand"]]
    with driver.session() as session:
        for i in range(0, len(brand_pairs), BATCH_SIZE):
            batch = brand_pairs[i : i + BATCH_SIZE]
            session.run("""
                UNWIND $pairs AS p
                MATCH (fp:FoodProduct {id: p.id})
                MATCH (b:Brand {name: p.brand})
                MERGE (fp)-[:MADE_BY]->(b)
            """, pairs=batch)

    # IN_CATEGORY relationships
    cat_pairs = [{"id": r["id"], "cat": r["category"]} for r in records]
    with driver.session() as session:
        for i in range(0, len(cat_pairs), BATCH_SIZE):
            batch = cat_pairs[i : i + BATCH_SIZE]
            session.run("""
                UNWIND $pairs AS p
                MATCH (fp:FoodProduct {id: p.id})
                MATCH (c:Category {name: p.cat})
                MERGE (fp)-[:IN_CATEGORY]->(c)
            """, pairs=batch)

    print(f"  [OK] {len(records)} FoodProduct nodes created.")
    print(f"  [OK] {len(brand_pairs)} MADE_BY rels, {len(cat_pairs)} IN_CATEGORY rels.")
    return records


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 11: LOAD PRODUCT INGREDIENTS + CONTAINS  (Cluster B)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def load_product_ingredients(driver, df_products: pd.DataFrame) -> set[str]:
    print("\n[Step 11] Loading Ingredient nodes + CONTAINS rels from products (Cluster B)...")

    new_ingredients: set[str] = set()
    product_ing_map: list[dict] = []

    for _, row in df_products.iterrows():
        raw = safe_str(row.get("ingredients_text", ""))
        if not raw:
            continue
        ings = split_product_ingredients(raw)
        if ings:
            product_ing_map.append({
                "product_id": safe_str(row["barcode"]) or "",
                "ings": ings,
            })
            new_ingredients.update(ings)

    # Upsert ingredient nodes (MERGE keeps existing Cluster A ingredients intact)
    ing_list = list(new_ingredients)
    with driver.session() as session:
        for i in range(0, len(ing_list), BATCH_SIZE):
            batch = ing_list[i : i + BATCH_SIZE]
            session.run(
                "UNWIND $names AS name MERGE (:Ingredient {name: name})",
                names=batch,
            )
    print(f"  [OK] {len(new_ingredients)} product ingredient nodes (merged into shared pool).")

    # CONTAINS relationships (FoodProduct â†’ Ingredient)
    with driver.session() as session:
        rel_count = 0
        valid_pairs = [p for p in product_ing_map if p["product_id"]]
        for i in range(0, len(valid_pairs), BATCH_SIZE):
            batch = valid_pairs[i : i + BATCH_SIZE]
            session.run("""
                UNWIND $pairs AS p
                MATCH (fp:FoodProduct {id: p.product_id})
                UNWIND p.ings AS ing_name
                MATCH (i:Ingredient {name: ing_name})
                MERGE (fp)-[:CONTAINS]->(i)
            """, pairs=batch)
            rel_count += sum(len(p["ings"]) for p in batch)

    print(f"  [OK] ~{rel_count} CONTAINS rels (FoodProduct â†’ Ingredient).")
    return new_ingredients


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 12: WIRE IS_ALLERGEN  (cross-cluster, shared Ingredient pool)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def wire_allergen_relationships(driver):
    print("\n[Step 12] Wiring IS_ALLERGEN relationships (cross-cluster)...")

    with driver.session() as session:
        result = session.run("MATCH (i:Ingredient) RETURN i.name AS name")
        all_ingredient_names = [r["name"] for r in result]

    allergen_pairs: list[dict] = []
    for ing_name in all_ingredient_names:
        allergens = detect_allergens(ing_name)
        for allergen in allergens:
            allergen_pairs.append({"ingredient": ing_name, "allergen": allergen})

    with driver.session() as session:
        for i in range(0, len(allergen_pairs), BATCH_SIZE):
            batch = allergen_pairs[i : i + BATCH_SIZE]
            session.run("""
                UNWIND $pairs AS p
                MATCH (i:Ingredient {name: p.ingredient})
                MATCH (a:AllergenTag {name: p.allergen})
                MERGE (i)-[:IS_ALLERGEN]->(a)
            """, pairs=batch)

    print(f"  [OK] {len(allergen_pairs)} IS_ALLERGEN rels wired across shared Ingredient pool.")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# STEP 13: VERIFY & PRINT SUMMARY
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def print_summary(driver):
    print("\n" + "=" * 65)
    print("  MIGRATION SUMMARY â€” NutriSense-AI v2 Dual-Cluster Graph")
    print("=" * 65)

    queries = {
        # Cluster A
        "Recipe nodes (Cluster A)":         "MATCH (n:Recipe) RETURN count(n) AS c",
        "Ingredient nodes (shared)":         "MATCH (n:Ingredient) RETURN count(n) AS c",
        "Cuisine nodes":                     "MATCH (n:Cuisine) RETURN count(n) AS c",
        "ImageClass nodes":                  "MATCH (n:ImageClass) RETURN count(n) AS c",
        "CONTAINS rels (Recipeâ†’Ingredient)": "MATCH (r:Recipe)-[:CONTAINS]->() RETURN count(*) AS c",
        "BELONGS_TO rels":                   "MATCH ()-[:BELONGS_TO]->() RETURN count(*) AS c",
        "MAPS_TO rels":                      "MATCH ()-[:MAPS_TO]->() RETURN count(*) AS c",
        # Cluster B
        "FoodProduct nodes (Cluster B)":     "MATCH (n:FoodProduct) RETURN count(n) AS c",
        "Brand nodes":                       "MATCH (n:Brand) RETURN count(n) AS c",
        "Category nodes":                    "MATCH (n:Category) RETURN count(n) AS c",
        "MADE_BY rels":                      "MATCH ()-[:MADE_BY]->() RETURN count(*) AS c",
        "IN_CATEGORY rels":                  "MATCH ()-[:IN_CATEGORY]->() RETURN count(*) AS c",
        "CONTAINS rels (Productâ†’Ingred)":    "MATCH (p:FoodProduct)-[:CONTAINS]->() RETURN count(*) AS c",
        # Cross-cluster
        "AllergenTag nodes":                 "MATCH (n:AllergenTag) RETURN count(n) AS c",
        "IS_ALLERGEN rels":                  "MATCH ()-[:IS_ALLERGEN]->() RETURN count(*) AS c",
    }

    with driver.session() as session:
        separator_printed = False
        for label, query in queries.items():
            if "FoodProduct" in label and not separator_printed:
                print("  ---")
                separator_printed = True
            result = session.run(query)
            count = result.single()["c"]
            print(f"  {label:<42} {count:>8,}")

    # --- Cluster A sample ---
    print("\n  [Sample] Recipe with ingredients:")
    with driver.session() as session:
        rows = session.run("""
            MATCH (r:Recipe)-[:CONTAINS]->(i:Ingredient)
            WITH r, collect(i.name) AS ings
            MATCH (r)-[:BELONGS_TO]->(c:Cuisine)
            RETURN r.name AS name, r.calories AS cal, c.name AS cuisine,
                   ings LIMIT 2
        """)
        for row in rows:
            ings_preview = ", ".join(row["ings"][:5])
            print(f"    {row['name'][:50]}  |  {row['cuisine']}  |  {row['cal']} kcal")
            print(f"      Ingredients: {ings_preview}...")

    # --- Cluster B sample ---
    print("\n  [Sample] FoodProduct with brand + category:")
    with driver.session() as session:
        rows = session.run("""
            MATCH (fp:FoodProduct)-[:MADE_BY]->(b:Brand)
            MATCH (fp)-[:IN_CATEGORY]->(cat:Category)
            RETURN fp.name AS name, b.name AS brand, cat.name AS cat,
                   fp.calories_100g AS cal, fp.nutriscore_grade AS grade
            LIMIT 3
        """)
        for row in rows:
            print(f"    {row['name'][:45]}  |  {row['brand']}  |  {row['cat']}  |  {row['cal']} kcal/100g  |  NutriScore {row['grade']}")

    # --- Allergen cross-cluster check ---
    print("\n  [Sample] Allergen-tagged ingredients (cross-cluster):")
    with driver.session() as session:
        rows = session.run("""
            MATCH (i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
            RETURN a.name AS allergen, collect(i.name)[..5] AS sample_ings,
                   count(i) AS total
            ORDER BY total DESC
        """)
        for row in rows:
            print(f"    {row['allergen']:<12}  ({row['total']} ingredients)  e.g. {row['sample_ings']}")

    print("\n" + "=" * 65)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# MAIN
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def main():
    print("=" * 65)
    print("  NutriSense-AI v2 â€” Dual Food Cluster Migration")
    print("=" * 65)

    # â”€â”€ Load & validate Cluster A source â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print(f"\nLoading {RECIPE_CSV_PATH} ...")
    df_recipes = pd.read_csv(RECIPE_CSV_PATH)
    before = len(df_recipes)
    df_recipes = df_recipes.drop_duplicates(subset=["recipe_original"], keep="first")
    df_recipes = df_recipes.dropna(subset=["final_food_name"])
    after = len(df_recipes)
    print(f"  {after} recipe rows  ({before - after} duplicates/nulls removed)")

    # â”€â”€ Load & validate Cluster B source â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print(f"\nLoading {PRODUCT_CSV_PATH} ...")
    df_products_raw = pd.read_csv(PRODUCT_CSV_PATH)
    print(f"  Raw rows in products CSV: {len(df_products_raw):,}")

    # Quality filter: require product_name + core macros
    mask = (
        df_products_raw["product_name"].notna()
        & df_products_raw["calories_100g"].notna()
        & df_products_raw["proteins_g_100g"].notna()
        & df_products_raw["carbohydrates_g_100g"].notna()
        & df_products_raw["fat_g_100g"].notna()
    )
    df_products = df_products_raw[mask].drop_duplicates(
        subset=["barcode"], keep="first"
    ).reset_index(drop=True)
    print(f"  {len(df_products):,} product rows pass quality filter "
          f"(name + all 4 macros present,  barcode deduplicated)")

    # â”€â”€ Connect & run migration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    driver = connect()

    try:
        clear_database(driver)
        create_constraints(driver)
        load_allergen_tags(driver)

        # â”€â”€ Cluster A â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        load_cuisines(driver, df_recipes)
        load_recipes(driver, df_recipes)
        load_recipe_ingredients(driver, df_recipes)
        create_cuisine_relationships(driver, df_recipes)
        image_classes = load_image_classes(driver)
        create_image_mappings(driver, image_classes)

        # â”€â”€ Cluster B â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        load_categories_and_brands(driver, df_products)
        load_food_products(driver, df_products)
        load_product_ingredients(driver, df_products)

        # â”€â”€ Cross-cluster allergen wiring â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        wire_allergen_relationships(driver)

        print_summary(driver)

        print("\n[SUCCESS] v2 DUAL-CLUSTER MIGRATION COMPLETE!")

    except Exception as exc:
        import traceback
        print(f"\n[ERROR] MIGRATION FAILED: {exc}")
        traceback.print_exc()
        raise
    finally:
        driver.close()


if __name__ == "__main__":
    main()
