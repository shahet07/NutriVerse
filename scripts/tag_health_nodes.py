"""
Phase 3 — GraphRAG: Create HealthTag nodes and auto-tag food nodes.

This script:
1. Creates 7 `HealthTag` nodes in Neo4j (idempotent MERGE).
2. Tags `Recipe` nodes with `SUITABLE_FOR` relationships based on nutrition
   thresholds derived from their per-serving macro values.
3. Tags `FoodProduct` nodes with the same HealthTags based on per-100g values.
4. Tags nodes as Vegan / Gluten Free / Paleo using AllergenTag graph traversal
   (nodes that do NOT contain allergen-linked ingredients receive those tags).

Run this AFTER `migrate_v2_dual_cluster.py` and (optionally) after
`generate_embeddings.py`.

Usage:
    python scripts/tag_health_nodes.py [--dry-run]
"""

import argparse
import logging
import os
import sys

from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── HealthTag definitions ──────────────────────────────────────────────────────

HEALTH_TAGS = [
    "High Protein",
    "Low Calorie",
    "Keto",
    "Diabetic Friendly",
    "Vegan",
    "Gluten Free",
    "Paleo",
]

# ── Nutrition thresholds ──────────────────────────────────────────────────────
#   Recipe   — per serving values stored directly on the node
#   Product  — per-100g values (suffix _100g)

RECIPE_THRESHOLDS = {
    # protein avg = 6g, max = 20.49g across the 725-recipe dataset
    # threshold > 12 captures the top ~15% of recipes by protein content
    "High Protein":      "r.protein     > 12",
    "Low Calorie":       "r.calories    < 300",
    "Keto":              "r.carbohydrates < 20 AND r.fats > 15",
    "Diabetic Friendly": "r.free_sugar  < 5  AND r.calories < 400",
}

PRODUCT_THRESHOLDS = {
    # proteins_100g avg = 12.75g across 6,432 products
    # > 8 targets the top ~40% of products (protein bars, dairy, pulses, etc.)
    "High Protein":      "fp.proteins_100g     > 8",
    "Low Calorie":       "fp.calories_100g     < 200",
    "Keto":              "fp.carbohydrates_100g < 10 AND fp.fat_100g > 15",
    "Diabetic Friendly": "fp.sugars_100g        < 5  AND fp.calories_100g < 250",
}

# Allergen-based tags  ─  a node is tagged if it does NOT link to any
# ingredient that IS_ALLERGEN the listed tags.
VEGAN_EXCLUDED_ALLERGENS    = ["Dairy", "Eggs", "Shellfish"]
GLUTEN_FREE_EXCLUDED_ALLERGENS = ["Gluten"]
PALEO_EXCLUDED_ALLERGENS    = ["Dairy", "Gluten"]


def tag_by_threshold(session, label: str, var: str, threshold_map: dict, dry_run: bool):
    """Create SUITABLE_FOR relationships from nutrition thresholds.
    Uses MERGE for idempotency (safe to re-run — no duplicates created).
    """
    for tag_name, condition in threshold_map.items():
        count_cypher = f"""
        MATCH (ht:HealthTag {{name: $tag}})
        MATCH ({var}:{label})
        WHERE {condition}
        RETURN count(*) AS would_create
        """
        if dry_run:
            result = session.run(count_cypher, tag=tag_name).single()
            logger.info("[dry-run] :%s → SUITABLE_FOR → '%s' : %d would be created",
                        label, tag_name, result["would_create"] if result else 0)
        else:
            cypher = f"""
            MATCH (ht:HealthTag {{name: $tag}})
            MATCH ({var}:{label})
            WHERE {condition}
            WITH {var}, ht
            MERGE ({var})-[:SUITABLE_FOR]->(ht)
            RETURN count(*) AS created
            """
            result = session.run(cypher, tag=tag_name).single()
            logger.info(":%s → SUITABLE_FOR → '%s' : %d rels created/merged",
                        label, tag_name, result["created"] if result else 0)


def tag_by_allergen_exclusion(
    session, label: str, var: str, tag_name: str,
    excluded_allergens: list[str], dry_run: bool
):
    """
    Tag nodes that contain NO ingredients linked to any of the excluded
    AllergenTags. Nodes with zero ingredients (no CONTAINS rels at all)
    are also tagged — they have no known allergens.
    Uses MERGE for idempotency.
    """
    allergen_list_str = "[" + ", ".join(f'"{a}"' for a in excluded_allergens) + "]"
    count_cypher = f"""
    MATCH ({var}:{label})
    WHERE NOT EXISTS {{
        MATCH ({var})-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
        WHERE a.name IN {allergen_list_str}
    }}
    RETURN count(*) AS would_create
    """
    if dry_run:
        result = session.run(count_cypher).single()
        logger.info("[dry-run] :%s → SUITABLE_FOR → '%s' : %d would be created",
                    label, tag_name, result["would_create"] if result else 0)
    else:
        cypher = f"""
        MATCH (ht:HealthTag {{name: $tag}})
        MATCH ({var}:{label})
        WHERE NOT EXISTS {{
            MATCH ({var})-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
            WHERE a.name IN {allergen_list_str}
        }}
        WITH {var}, ht
        MERGE ({var})-[:SUITABLE_FOR]->(ht)
        RETURN count(*) AS created
        """
        result = session.run(cypher, tag=tag_name).single()
        logger.info(":%s → SUITABLE_FOR → '%s' : %d rels created/merged",
                    label, tag_name, result["created"] if result else 0)


def main():
    parser = argparse.ArgumentParser(description="Create HealthTag nodes and auto-tag food nodes (Phase 3)")
    parser.add_argument("--dry-run", action="store_true", help="Report counts but don't write")
    args = parser.parse_args()

    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USER")
    password = os.getenv("NEO4J_PASSWORD")

    if not all([uri, user, password]):
        logger.error("Missing NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD in environment.")
        sys.exit(1)

    driver = GraphDatabase.driver(uri, auth=(user, password))
    driver.verify_connectivity()
    logger.info("Connected to Neo4j at %s", uri)

    with driver.session() as session:

        # ── Step 1: Create unique constraint on HealthTag.name ──────────
        if not args.dry_run:
            try:
                session.run(
                    "CREATE CONSTRAINT health_tag_name IF NOT EXISTS "
                    "FOR (h:HealthTag) REQUIRE h.name IS UNIQUE"
                )
                logger.info("HealthTag uniqueness constraint ensured.")
            except Exception as exc:
                logger.warning("Constraint creation warning (may already exist): %s", exc)

        # ── Step 2: Merge HealthTag nodes ─────────────────────────────
        logger.info("Merging %d HealthTag nodes…", len(HEALTH_TAGS))
        if not args.dry_run:
            for tag in HEALTH_TAGS:
                session.run("MERGE (:HealthTag {name: $name})", name=tag)
            logger.info("HealthTag nodes created/merged.")
        else:
            logger.info("[dry-run] Would merge: %s", HEALTH_TAGS)

        # ── Step 3: Tag Recipes by nutrition thresholds ───────────────
        logger.info("--- Tagging Recipe nodes (nutrition thresholds) ---")
        tag_by_threshold(session, "Recipe", "r", RECIPE_THRESHOLDS, args.dry_run)

        # ── Step 4: Tag FoodProducts by nutrition thresholds ─────────
        logger.info("--- Tagging FoodProduct nodes (nutrition thresholds) ---")
        tag_by_threshold(session, "FoodProduct", "fp", PRODUCT_THRESHOLDS, args.dry_run)

        # ── Step 5: Vegan tagging (allergen-exclusion) ────────────────
        logger.info("--- Allergen-exclusion tagging: Vegan ---")
        tag_by_allergen_exclusion(session, "Recipe", "r", "Vegan",
                                  VEGAN_EXCLUDED_ALLERGENS, args.dry_run)
        tag_by_allergen_exclusion(session, "FoodProduct", "fp", "Vegan",
                                  VEGAN_EXCLUDED_ALLERGENS, args.dry_run)

        # ── Step 6: Gluten Free tagging ────────────────────────────────
        logger.info("--- Allergen-exclusion tagging: Gluten Free ---")
        tag_by_allergen_exclusion(session, "Recipe", "r", "Gluten Free",
                                  GLUTEN_FREE_EXCLUDED_ALLERGENS, args.dry_run)
        tag_by_allergen_exclusion(session, "FoodProduct", "fp", "Gluten Free",
                                  GLUTEN_FREE_EXCLUDED_ALLERGENS, args.dry_run)

        # ── Step 7: Paleo tagging ──────────────────────────────────────
        #   Paleo = High Protein + no Dairy + no Gluten
        logger.info("--- Allergen-exclusion tagging: Paleo ---")
        paleo_cypher_recipe = """
        MATCH (ht:HealthTag {name: 'Paleo'})
        MATCH (r:Recipe)
        WHERE r.protein > 12
          AND NOT EXISTS {
            MATCH (r)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
            WHERE a.name IN ['Dairy', 'Gluten']
          }
        WITH r, ht
        MERGE (r)-[:SUITABLE_FOR]->(ht)
        RETURN count(*) AS created
        """
        paleo_cypher_product = """
        MATCH (ht:HealthTag {name: 'Paleo'})
        MATCH (fp:FoodProduct)
        WHERE fp.proteins_100g > 8
          AND NOT EXISTS {
            MATCH (fp)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
            WHERE a.name IN ['Dairy', 'Gluten']
          }
        WITH fp, ht
        MERGE (fp)-[:SUITABLE_FOR]->(ht)
        RETURN count(*) AS created
        """
        if not args.dry_run:
            r = session.run(paleo_cypher_recipe).single()
            logger.info(":Recipe → SUITABLE_FOR → 'Paleo' : %d rels created",
                        r["created"] if r else 0)
            r = session.run(paleo_cypher_product).single()
            logger.info(":FoodProduct → SUITABLE_FOR → 'Paleo' : %d rels created",
                        r["created"] if r else 0)
        else:
            logger.info("[dry-run] Skipping Paleo writes.")

        # ── Step 8: Summary ────────────────────────────────────────────
        if not args.dry_run:
            summary = session.run(
                """
                MATCH (n)-[:SUITABLE_FOR]->(ht:HealthTag)
                RETURN labels(n)[0] AS node_label, ht.name AS tag, count(*) AS total
                ORDER BY node_label, tag
                """
            )
            logger.info("\n── SUITABLE_FOR relationship summary ──")
            for row in summary:
                logger.info("  %-14s → %-20s : %d", row["node_label"], row["tag"], row["total"])

    driver.close()
    logger.info("Health tagging complete.")


if __name__ == "__main__":
    main()
