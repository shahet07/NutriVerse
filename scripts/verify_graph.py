"""
verify_graph.py â€” Post-migration verification for NutriSense-AI v2 Dual-Cluster Graph.

Checks:
    1. Node & relationship counts for both clusters
    2. Cluster A (Recipe) sample queries
    3. Cluster B (FoodProduct) sample queries
    4. Cross-cluster allergen checks
    5. Constraint & index status

Usage:
    .\.Nutri\Scripts\python.exe scripts\verify_graph.py
"""

import os
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

driver = GraphDatabase.driver(
    os.getenv("NEO4J_URI"),
    auth=(os.getenv("NEO4J_USER"), os.getenv("NEO4J_PASSWORD")),
)

PASS = "[PASS]"
WARN = "[WARN]"
FAIL = "[FAIL]"

failures: list[str] = []


def check(label: str, actual: int, minimum: int):
    status = PASS if actual >= minimum else FAIL
    if status == FAIL:
        failures.append(f"{label}: expected >= {minimum}, got {actual}")
    print(f"  {status}  {label:<48} {actual:>8,}  (min {minimum:,})")


with driver.session() as s:

    # â”€â”€â”€ 1. NODE & RELATIONSHIP COUNTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("\n" + "=" * 70)
    print("  [1] NODE & RELATIONSHIP COUNTS")
    print("=" * 70)

    count_checks = [
        # label                                 query                                                               min
        ("Recipe nodes (Cluster A)",            "MATCH (n:Recipe) RETURN count(n) AS c",                          700),
        ("Ingredient nodes (shared pool)",      "MATCH (n:Ingredient) RETURN count(n) AS c",                      300),
        ("Cuisine nodes",                        "MATCH (n:Cuisine) RETURN count(n) AS c",                         50),
        ("ImageClass nodes",                    "MATCH (n:ImageClass) RETURN count(n) AS c",                      140),
        ("CONTAINS rels Recipeâ†’Ingredient",     "MATCH (r:Recipe)-[:CONTAINS]->() RETURN count(*) AS c",         3000),
        ("BELONGS_TO rels",                     "MATCH ()-[:BELONGS_TO]->() RETURN count(*) AS c",                600),
        ("MAPS_TO rels",                        "MATCH ()-[:MAPS_TO]->() RETURN count(*) AS c",                    50),
        ("FoodProduct nodes (Cluster B)",       "MATCH (n:FoodProduct) RETURN count(n) AS c",                    5000),
        ("Brand nodes",                         "MATCH (n:Brand) RETURN count(n) AS c",                           100),
        ("Category nodes",                      "MATCH (n:Category) RETURN count(n) AS c",                          5),
        ("MADE_BY rels",                        "MATCH ()-[:MADE_BY]->() RETURN count(*) AS c",                  3000),
        ("IN_CATEGORY rels",                    "MATCH ()-[:IN_CATEGORY]->() RETURN count(*) AS c",              5000),
        ("CONTAINS rels FoodProductâ†’Ingred",    "MATCH (fp:FoodProduct)-[:CONTAINS]->() RETURN count(*) AS c",      1),
        ("AllergenTag nodes",                   "MATCH (n:AllergenTag) RETURN count(n) AS c",                        7),
        ("IS_ALLERGEN rels",                    "MATCH ()-[:IS_ALLERGEN]->() RETURN count(*) AS c",                  5),
    ]
    for label, query, minimum in count_checks:
        result = s.run(query)
        count = result.single()["c"]
        check(label, count, minimum)

    # â”€â”€â”€ 2. CLUSTER A â€” RECIPE SAMPLE QUERIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("\n" + "=" * 70)
    print("  [2] CLUSTER A â€” RECIPE SAMPLE QUERIES")
    print("=" * 70)

    print("\n  Sample: Butter Chicken")
    result = s.run("""
        MATCH (r:Recipe)-[:CONTAINS]->(i:Ingredient)
        WHERE toLower(r.name) CONTAINS 'butter chicken'
        WITH r, collect(i.name) AS ingredients
        MATCH (r)-[:BELONGS_TO]->(c:Cuisine)
        RETURN r.name AS name, r.calories AS cal, r.protein AS protein,
               r.fats AS fats, c.name AS cuisine, ingredients
        LIMIT 1
    """)
    for rec in result:
        print(f"    {rec['name']}")
        print(f"    Cuisine  : {rec['cuisine']}")
        print(f"    Nutrition: {rec['cal']} kcal | {rec['protein']}g protein | {rec['fats']}g fat")
        print(f"    Ingreds  : {', '.join(rec['ingredients'][:8])}...")

    print("\n  Cuisine distribution (top 10):")
    result = s.run("""
        MATCH (c:Cuisine)<-[:BELONGS_TO]-(r:Recipe)
        RETURN c.name AS cuisine, count(r) AS n
        ORDER BY n DESC LIMIT 10
    """)
    for rec in result:
        print(f"    {rec['cuisine']}: {rec['n']}")

    print("\n  High-protein recipes (>30g):")
    result = s.run("""
        MATCH (r:Recipe)-[:BELONGS_TO]->(c:Cuisine)
        WHERE r.protein > 30
        RETURN r.name AS name, r.protein AS prot, c.name AS cuisine
        ORDER BY prot DESC LIMIT 5
    """)
    for rec in result:
        print(f"    {rec['name']} ({rec['cuisine']}): {rec['prot']}g protein")

    print("\n  ImageClass â†’ Recipe mappings (sample):")
    result = s.run("""
        MATCH (ic:ImageClass)-[:MAPS_TO]->(r:Recipe)
        RETURN ic.name AS cls, r.name AS recipe LIMIT 8
    """)
    for rec in result:
        print(f"    {rec['cls']} â†’ {rec['recipe'][:60]}")

    # â”€â”€â”€ 3. CLUSTER B â€” FOODPRODUCT SAMPLE QUERIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("\n" + "=" * 70)
    print("  [3] CLUSTER B â€” FOODPRODUCT SAMPLE QUERIES")
    print("=" * 70)

    print("\n  Category distribution:")
    result = s.run("""
        MATCH (cat:Category)<-[:IN_CATEGORY]-(fp:FoodProduct)
        RETURN cat.name AS category, count(fp) AS n
        ORDER BY n DESC LIMIT 12
    """)
    for rec in result:
        print(f"    {rec['category']}: {rec['n']}")

    print("\n  Top brands by product count:")
    result = s.run("""
        MATCH (b:Brand)<-[:MADE_BY]-(fp:FoodProduct)
        RETURN b.name AS brand, count(fp) AS n
        ORDER BY n DESC LIMIT 10
    """)
    for rec in result:
        print(f"    {rec['brand']}: {rec['n']}")

    print("\n  Sample products with full nutrition:")
    result = s.run("""
        MATCH (fp:FoodProduct)-[:MADE_BY]->(b:Brand)
        MATCH (fp)-[:IN_CATEGORY]->(cat:Category)
        WHERE fp.calories_100g IS NOT NULL
        RETURN fp.name AS name, b.name AS brand, cat.name AS cat,
               fp.calories_100g AS cal, fp.proteins_100g AS prot,
               fp.nutriscore_grade AS grade
        LIMIT 5
    """)
    for rec in result:
        print(f"    {rec['name'][:45]}  |  {rec['brand']}  |  {rec['cat']}")
        print(f"      {rec['cal']} kcal/100g  |  {rec['prot']}g protein  |  NutriScore: {rec['grade']}")

    # â”€â”€â”€ 4. CROSS-CLUSTER ALLERGEN CHECKS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("\n" + "=" * 70)
    print("  [4] CROSS-CLUSTER â€” ALLERGEN CHECKS")
    print("=" * 70)

    print("\n  AllergenTag coverage across shared Ingredient pool:")
    result = s.run("""
        MATCH (i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
        RETURN a.name AS allergen, count(i) AS n,
               collect(i.name)[..4] AS sample_ings
        ORDER BY n DESC
    """)
    for rec in result:
        print(f"    {rec['allergen']:<12} {rec['n']:>3} ingredients   e.g. {rec['sample_ings']}")

    print("\n  Recipes containing dairy ingredients:")
    result = s.run("""
        MATCH (r:Recipe)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag {name: 'Dairy'})
        RETURN r.name AS recipe, collect(i.name) AS dairy_ings
        LIMIT 5
    """)
    for rec in result:
        print(f"    {rec['recipe'][:55]}  â†’  {rec['dairy_ings'][:3]}")

    print("\n  FoodProducts containing gluten ingredients:")
    result = s.run("""
        MATCH (fp:FoodProduct)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag {name: 'Gluten'})
        RETURN fp.name AS product, collect(i.name) AS gluten_ings
        LIMIT 5
    """)
    for rec in result:
        print(f"    {rec['product'][:55]}  â†’  {rec['gluten_ings'][:3]}")

    # â”€â”€â”€ 5. CONSTRAINTS & INDEXES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    print("\n" + "=" * 70)
    print("  [5] CONSTRAINTS & INDEXES")
    print("=" * 70)

    result = s.run("SHOW CONSTRAINTS")
    constraints = [dict(r) for r in result]
    print(f"\n  Active constraints: {len(constraints)}")
    for c in constraints:
        name = c.get("name", "")
        label = c.get("labelsOrTypes", ["?"])[0] if c.get("labelsOrTypes") else "?"
        props = c.get("properties", ["?"])
        print(f"    {name:<35}  {label}.{props}")

    result = s.run("SHOW INDEXES")
    indexes = [dict(r) for r in result]
    fulltext = [i for i in indexes if i.get("type") == "FULLTEXT"]
    print(f"\n  Full-text indexes: {len(fulltext)}")
    for idx in fulltext:
        print(f"    {idx.get('name')}  â†’  {idx.get('labelsOrTypes')} {idx.get('properties')}")

driver.close()

# â”€â”€â”€ RESULT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
print("\n" + "=" * 70)
if failures:
    print(f"  {FAIL} {len(failures)} check(s) failed:")
    for f in failures:
        print(f"    - {f}")
else:
    print("  [SUCCESS] All verification checks passed â€” v2 dual-cluster graph is healthy!")
print("=" * 70)
