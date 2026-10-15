"""
NutriSense Recipe Migration — ingest nutrisense_recipes.csv into Neo4j Aura.

Replaces the old Final_unified_dataset.csv ingest. New schema drops Cuisine and
all dataset-prep scoring artifacts; adds serving_size_g.

Recipe IDs are sequential 1-based integers matching CSV row order (1..1014).
The CSV `source` column is intentionally ignored — not stored on the graph.

Preserved nodes: :FoodProduct, :Brand, :Category, :AllergenTag, :HealthTag,
:User, :SearchEvent, :ImageClass, user-pref :Cuisine (kept via PREFERS_CUISINE
guard). Engagement edges (LIKED/DISLIKED/COOKED/VIEWED -> Recipe) are wiped.

Usage:
  .\.Nutri\Scripts\python.exe scripts\migrate_nutrisense_recipes.py
"""

import os
import re
import json
import pandas as pd
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

URI = os.getenv("NEO4J_URI")
AUTH = (os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD"))

CSV_PATH = "Dataset/processed/nutrisense_recipes.csv"
CLASS_NAMES_PATH = "scripts/class_names.json"

BATCH_SIZE = 200

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


def safe_float(val):
    if pd.isna(val):
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def safe_int(val):
    if pd.isna(val):
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def safe_str(val, default: str = "") -> str:
    if pd.isna(val):
        return default
    return str(val).strip()


def clean_ingredient(name: str) -> str:
    name = name.strip().lower()
    if len(name) <= 1 and not name.isalpha():
        return ""
    name = re.sub(r"^\)+|\(+$", "", name).strip()
    name = re.sub(
        r"^\d+[\d\s/\.]*(?:g|kg|ml|l|cup|tsp|tbsp|oz|lb|piece|pcs)?\s+",
        "",
        name,
    )
    return name


def detect_allergens(ingredient_name: str) -> list[str]:
    lower = ingredient_name.lower()
    return [a for a, kws in ALLERGEN_MAP.items() if any(kw in lower for kw in kws)]


def connect():
    driver = GraphDatabase.driver(URI, auth=AUTH)
    driver.verify_connectivity()
    print(f"Connected to Neo4j at {URI}")
    return driver


def cleanup_recipe_subgraph(driver):
    """Wipe Recipe subgraph + recipe-side Cuisine, preserve everything else."""
    print("\n[1/8] Cleaning up old Recipe subgraph...")
    statements = [
        ("LIKED/DISLIKED/COOKED/VIEWED -> Recipe edges",
         "MATCH (:User)-[r:LIKED|DISLIKED|COOKED|VIEWED]->(:Recipe) DELETE r"),
        ("MAPS_TO -> Recipe edges",
         "MATCH ()-[r:MAPS_TO]->(:Recipe) DELETE r"),
        ("BELONGS_TO edges",
         "MATCH (r:Recipe)-[b:BELONGS_TO]->() DELETE b"),
        ("CONTAINS edges (Recipe -> Ingredient)",
         "MATCH (r:Recipe)-[c:CONTAINS]->(:Ingredient) DELETE c"),
        ("SUITABLE_FOR edges (Recipe -> HealthTag)",
         "MATCH (r:Recipe)-[s:SUITABLE_FOR]->(:HealthTag) DELETE s"),
        ("Recipe nodes (DETACH DELETE)",
         "MATCH (r:Recipe) DETACH DELETE r"),
        ("Cuisine nodes not referenced by user prefs",
         "MATCH (c:Cuisine) WHERE NOT (()-[:PREFERS_CUISINE]->(c)) DETACH DELETE c"),
    ]
    with driver.session() as session:
        for label, cypher in statements:
            summary = session.run(cypher).consume()
            counters = summary.counters
            print(f"  [OK] {label} — nodes_deleted={counters.nodes_deleted} "
                  f"rels_deleted={counters.relationships_deleted}")

    # Drop indexes that will be rebuilt
    with driver.session() as session:
        for idx in ("recipe_embedding", "recipe_name_fulltext"):
            try:
                session.run(f"DROP INDEX {idx} IF EXISTS")
                print(f"  [OK] dropped index {idx}")
            except Exception as e:
                print(f"  [WARN] drop index {idx}: {e}")


def create_constraints(driver):
    print("\n[2/8] Creating constraints & indexes...")
    statements = [
        "CREATE CONSTRAINT recipe_id IF NOT EXISTS FOR (r:Recipe) REQUIRE r.id IS UNIQUE",
        "CREATE CONSTRAINT ingredient_name IF NOT EXISTS FOR (i:Ingredient) REQUIRE i.name IS UNIQUE",
        "CREATE CONSTRAINT imageclass_name IF NOT EXISTS FOR (ic:ImageClass) REQUIRE ic.name IS UNIQUE",
        "CREATE INDEX recipe_food_name_idx IF NOT EXISTS FOR (r:Recipe) ON (r.food_name)",
    ]
    with driver.session() as session:
        for c in statements:
            session.run(c)
            print(f"  [OK] {c.split('IF NOT EXISTS')[0].strip()}")
        try:
            session.run(
                "CREATE FULLTEXT INDEX recipe_name_fulltext IF NOT EXISTS "
                "FOR (r:Recipe) ON EACH [r.name, r.food_name]"
            )
            print("  [OK] CREATE FULLTEXT INDEX recipe_name_fulltext")
        except Exception as e:
            print(f"  [WARN] fulltext index: {e}")


def load_recipes(driver, df):
    print("\n[3/8] Loading Recipe nodes...")
    recipes = []
    for idx, row in enumerate(df.itertuples(index=False), start=1):
        food_name = safe_str(row.food_name)
        recipe = {
            "id": idx,
            "name": food_name,           # mirror food_name for fulltext compat
            "food_name": food_name,
            "serving_size_g": safe_float(row.serving_size_g),
            "prep_time_mins": safe_int(row.prep_time_mins) or 0,
            "instructions": safe_str(row.instructions),
            "raw_ingredients": safe_str(row.raw_ingredients),
            "calories": safe_float(row.calories),
            "carbohydrates": safe_float(row.carbohydrates),
            "protein": safe_float(row.protein),
            "fats": safe_float(row.fats),
            "free_sugar": safe_float(row.free_sugar),
            "fibre": safe_float(row.fibre),
            "sodium": safe_float(row.sodium),
            "calcium": safe_float(row.calcium),
            "iron": safe_float(row.iron),
            "vitamin_c": safe_float(row.vitamin_c),
            "folate": safe_float(row.folate),
        }
        recipes.append(recipe)

    with driver.session() as session:
        for i in range(0, len(recipes), BATCH_SIZE):
            batch = recipes[i:i + BATCH_SIZE]
            session.run("""
                UNWIND $recipes AS r
                CREATE (n:Recipe {
                    id: r.id,
                    name: r.name,
                    food_name: r.food_name,
                    serving_size_g: r.serving_size_g,
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
                    folate: r.folate
                })
            """, recipes=batch)
            print(f"  Batch {i // BATCH_SIZE + 1}: {len(batch)} recipes")
    print(f"  [OK] {len(recipes)} Recipe nodes created.")
    return recipes


def load_ingredients_and_contains(driver, df):
    print("\n[4/8] Loading Ingredient nodes & CONTAINS relationships...")
    all_ingredients: set[str] = set()
    pairs: list[dict] = []  # list of {recipe_id, ing_name}

    for idx, row in enumerate(df.itertuples(index=False), start=1):
        raw = safe_str(row.raw_ingredients)
        if not raw:
            continue
        for part in raw.split(","):
            cleaned = clean_ingredient(part)
            if cleaned:
                all_ingredients.add(cleaned)
                pairs.append({"recipe_id": idx, "ing": cleaned})

    ing_list = sorted(all_ingredients)
    with driver.session() as session:
        for i in range(0, len(ing_list), BATCH_SIZE):
            batch = ing_list[i:i + BATCH_SIZE]
            session.run(
                "UNWIND $ingredients AS name MERGE (i:Ingredient {name: name})",
                ingredients=batch,
            )
    print(f"  [OK] {len(all_ingredients)} Ingredient nodes upserted.")

    with driver.session() as session:
        for i in range(0, len(pairs), BATCH_SIZE):
            batch = pairs[i:i + BATCH_SIZE]
            session.run("""
                UNWIND $pairs AS p
                MATCH (r:Recipe {id: p.recipe_id})
                MATCH (i:Ingredient {name: p.ing})
                MERGE (r)-[:CONTAINS]->(i)
            """, pairs=batch)
    print(f"  [OK] {len(pairs)} CONTAINS relationships created.")
    return all_ingredients


def tag_allergens(driver, all_ingredients):
    print("\n[5/8] Tagging allergens (IS_ALLERGEN edges)...")
    rel_count = 0
    with driver.session() as session:
        for ing in all_ingredients:
            allergens = detect_allergens(ing)
            if not allergens:
                continue
            session.run("""
                UNWIND $allergens AS a
                MERGE (t:AllergenTag {name: a})
                WITH t
                MATCH (i:Ingredient {name: $ing})
                MERGE (i)-[:IS_ALLERGEN]->(t)
            """, allergens=allergens, ing=ing)
            rel_count += len(allergens)
    print(f"  [OK] {rel_count} IS_ALLERGEN relationships created.")


def load_image_classes(driver):
    print("\n[6/8] Loading ImageClass nodes...")
    with open(CLASS_NAMES_PATH, "r", encoding="utf-8") as f:
        classes = json.load(f)
    with driver.session() as session:
        session.run(
            "UNWIND $classes AS name MERGE (ic:ImageClass {name: name})",
            classes=classes,
        )
    print(f"  [OK] {len(classes)} ImageClass nodes upserted.")
    return classes


def create_image_mappings(driver, image_classes):
    print("\n[7/8] Creating MAPS_TO relationships (ImageClass -> Recipe)...")
    mapped = 0
    with driver.session() as session:
        result = session.run("MATCH (r:Recipe) RETURN r.food_name AS food_name")
        food_names = [(rec["food_name"] or "").lower().strip() for rec in result]

        for cls in image_classes:
            cls_lower = cls.lower().strip()
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
    queries = {
        "Recipe nodes":          "MATCH (r:Recipe) RETURN count(r) AS c",
        "Ingredient nodes":      "MATCH (i:Ingredient) RETURN count(i) AS c",
        "AllergenTag nodes":     "MATCH (t:AllergenTag) RETURN count(t) AS c",
        "ImageClass nodes":      "MATCH (ic:ImageClass) RETURN count(ic) AS c",
        "Cuisine nodes (should be 0 or onboarding-only)":
            "MATCH (c:Cuisine) RETURN count(c) AS c",
        "CONTAINS rels":         "MATCH ()-[r:CONTAINS]->() RETURN count(r) AS c",
        "IS_ALLERGEN rels":      "MATCH ()-[r:IS_ALLERGEN]->() RETURN count(r) AS c",
        "MAPS_TO rels":          "MATCH ()-[r:MAPS_TO]->() RETURN count(r) AS c",
        "BELONGS_TO rels (should be 0)":
            "MATCH ()-[r:BELONGS_TO]->() RETURN count(r) AS c",
    }
    with driver.session() as session:
        for label, query in queries.items():
            count = session.run(query).single()["c"]
            print(f"  {label}: {count}")

    print("\n--- Sample recipe ---")
    with driver.session() as session:
        result = session.run("""
            MATCH (r:Recipe)
            RETURN r.id AS id, r.food_name AS name, r.serving_size_g AS serving,
                   r.calories AS cal, r.protein AS protein, r.prep_time_mins AS prep
            ORDER BY r.id LIMIT 3
        """)
        for rec in result:
            print(f"  #{rec['id']:>4}  {rec['name']}  "
                  f"({rec['serving']}g, {rec['cal']} kcal, "
                  f"{rec['protein']}g protein, {rec['prep']} min)")


def main():
    print("=" * 60)
    print("NutriSense recipe migration -> Neo4j Aura")
    print("=" * 60)

    df = pd.read_csv(CSV_PATH)
    print(f"Loaded {len(df)} rows from {CSV_PATH}")

    driver = connect()
    try:
        cleanup_recipe_subgraph(driver)
        create_constraints(driver)
        load_recipes(driver, df)
        all_ings = load_ingredients_and_contains(driver, df)
        tag_allergens(driver, all_ings)
        image_classes = load_image_classes(driver)
        create_image_mappings(driver, image_classes)
        print("\n[8/8] Done.")
        print_summary(driver)
        print("\n[SUCCESS] Recipe migration complete.")
        print("Next: run scripts/tag_health_nodes.py, then scripts/generate_embeddings.py")
    except Exception as e:
        print(f"\n[ERROR] Migration failed: {e}")
        raise
    finally:
        driver.close()


if __name__ == "__main__":
    main()
