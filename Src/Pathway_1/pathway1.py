import re
from rapidfuzz import fuzz, process

MIN_COMPOSITE_SCORE = 75
TOP_K_CANDIDATES = 5

WEIGHT_TOKENSET = 0.6
WEIGHT_WRATIO = 0.4

VARIANT_SCORE_DELTA = 10  
MAX_VARIANTS = 4         

def clean_minimal(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = text.lower()
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r"[^a-z\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()

NEGATIVE_TOKEN_PAIRS = {
    ("idli", "dosa"),
    ("roti", "naan"),
    ("pulao", "khichdi"),
    ("kheer", "payasam")
}

def negative_pair_penalty(q_tokens, c_tokens):
    penalty = 0
    for a, b in NEGATIVE_TOKEN_PAIRS:
        if a in q_tokens and b in c_tokens:
            penalty += 20
        if b in q_tokens and a in c_tokens:
            penalty += 20
    return penalty

def composite_score(q_clean, c_clean):
    ts = fuzz.token_set_ratio(q_clean, c_clean)
    wr = fuzz.WRatio(q_clean, c_clean)

    q_tokens = set(q_clean.split())
    c_tokens = set(c_clean.split())

    penalty = negative_pair_penalty(q_tokens, c_tokens)

    score = (
        WEIGHT_TOKENSET * ts +
        WEIGHT_WRATIO * wr
    ) - penalty

    return score

def to_python_type(x):
    if hasattr(x, "item"):
        return x.item()
    return x


# Maps Neo4j snake_case property names to human-readable display keys
# to keep backward compatibility with LLM prompts and the frontend.
NUTRITION_FIELD_MAP = {
    "calories":       "Calories (kcal)",
    "carbohydrates":  "Carbohydrates (g)",
    "protein":        "Protein (g)",
    "fats":           "Fats (g)",
    "free_sugar":     "Free Sugar (g)",
    "fibre":          "Fibre (g)",
    "sodium":         "Sodium (mg)",
    "calcium":        "Calcium (mg)",
    "iron":           "Iron (mg)",
    "vitamin_c":      "Vitamin C (mg)",
    "folate":         "Folate (µg)",
}


def pathway_1_lookup(recipe_name: str, neo4j_client) -> dict:
    """
    Pathway 1 (Multi-output) — Neo4j-backed.
    - Input : extracted recipe name + an initialised Neo4jClient
    - Output: {status: FOUND|NOT_FOUND, results: [...]}
    Output contract is identical to the previous pandas version.
    """
    query_clean = clean_minimal(recipe_name)

    # Stage 1: fetch all recipe names from Neo4j
    all_recipes = neo4j_client.get_all_recipe_names()
    if not all_recipes:
        return {"status": "NOT_FOUND", "results": []}

    # Build mapping: clean_name -> original_name (needed for get_recipe_by_name)
    name_map: dict = {}
    for r in all_recipes:
        original = r.get("name", "")
        clean = clean_minimal(original)
        if clean:
            name_map[clean] = original

    clean_names = list(name_map.keys())

    # Stage 2: RapidFuzz top-K candidate generation
    raw_candidates = process.extract(
        query_clean,
        clean_names,
        scorer=fuzz.token_set_ratio,
        limit=TOP_K_CANDIDATES,
    )

    # Stage 3: composite re-scoring + threshold filter
    scored = []
    for cand_clean, _, _ in raw_candidates:
        score = composite_score(query_clean, cand_clean)
        if score >= MIN_COMPOSITE_SCORE:
            scored.append((name_map[cand_clean], score))

    if not scored:
        return {"status": "NOT_FOUND", "results": []}

    scored.sort(key=lambda x: x[1], reverse=True)

    # Stage 4: fetch full records from Neo4j
    results = []
    seen: set = set()

    for original_name, score in scored[: MAX_VARIANTS + 1]:
        if original_name.lower() in seen:
            continue
        seen.add(original_name.lower())

        record = neo4j_client.get_recipe_by_name(original_name)
        if not record:
            continue

        nutrition = {
            display_key: to_python_type(record.get(neo4j_key))
            for neo4j_key, display_key in NUTRITION_FIELD_MAP.items()
            if record.get(neo4j_key) is not None
        }

        results.append({
            "recipe_name": record.get("name", original_name),
            "confidence": round(min(score / 100, 0.95), 4),
            "nutrition": nutrition,
            "ingredients": record.get("raw_ingredients", ""),
            "instructions": record.get("instructions", ""),
            "meta": {
                "id": record.get("id"),
                "serving_size_g": record.get("serving_size_g"),
                "total_time": to_python_type(record.get("prep_time_mins")),
            },
        })

    if not results:
        return {"status": "NOT_FOUND", "results": []}

    return {"status": "FOUND", "results": results}