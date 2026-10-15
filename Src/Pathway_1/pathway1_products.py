"""
Pathway 1 (Products) — fuzzy lookup for FoodProduct nodes in Neo4j.

Nearly identical in structure to ``pathway1.py`` (which handles Recipe nodes)
but adapted for the FoodProduct schema:
  - Uses ``neo4j_client.search_products_by_name()`` for full-text candidate generation.
  - Returns product nutrition fields (per-100g values) with a ``cluster: "product"`` tag.
"""

from __future__ import annotations

import re
from rapidfuzz import fuzz, process

MIN_PRODUCT_SCORE = 65    # slightly lower than recipe threshold (product names vary more)
TOP_K_CANDIDATES  = 5
MAX_VARIANTS      = 4

WEIGHT_TOKENSET = 0.55
WEIGHT_WRATIO   = 0.45


def _clean(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = text.lower()
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _composite(q: str, c: str) -> float:
    return WEIGHT_TOKENSET * fuzz.token_set_ratio(q, c) + WEIGHT_WRATIO * fuzz.WRatio(q, c)


PRODUCT_FIELD_MAP = {
    "calories_100g":      "Calories per 100g (kcal)",
    "proteins_100g":      "Protein per 100g (g)",
    "carbohydrates_100g": "Carbohydrates per 100g (g)",
    "fat_100g":           "Fat per 100g (g)",
    "fiber_100g":         "Fibre per 100g (g)",
    "sodium_100g":        "Sodium per 100g (mg)",
    "sugars_100g":        "Sugars per 100g (g)",
}


def pathway_1_product_lookup(query: str, neo4j_client) -> dict:
    """
    Product-cluster fuzzy lookup (mirrors ``pathway_1_lookup`` for recipes).

    Returns::

        {
            "status":  "FOUND" | "NOT_FOUND",
            "cluster": "product",
            "results": [
                {
                    "product_name":  str,
                    "brand":         str | None,
                    "category":      str | None,
                    "confidence":    float,
                    "nutrition":     dict,
                    "nutriscore":    str | None,
                    "nova_group":    float | None,
                    "serving_size":  str | None,
                    "image_url":     str | None,
                    "meta": { ... },
                }
            ],
        }
    """
    query_clean = _clean(query)

    # -- Stage 1: fetch all product names from Neo4j
    all_products = neo4j_client.get_all_product_names()   # [{id, name, brand}]
    if not all_products:
        return {"status": "NOT_FOUND", "cluster": "product", "results": []}

    # Build mapping: clean_name -> (original_name, id)
    name_map: dict[str, tuple[str, str]] = {}
    for p in all_products:
        original = p.get("name", "")
        clean    = _clean(original)
        if clean:
            name_map[clean] = (original, p.get("id", ""))

    clean_names = list(name_map.keys())

    # -- Stage 2: RapidFuzz candidate generation
    raw_candidates = process.extract(
        query_clean, clean_names,
        scorer=fuzz.token_set_ratio,
        limit=TOP_K_CANDIDATES,
    )

    # -- Stage 3: composite re-scoring + threshold filter
    scored: list[tuple[str, str, float]] = []
    for cand_clean, _, _ in raw_candidates:
        score = _composite(query_clean, cand_clean)
        if score >= MIN_PRODUCT_SCORE:
            original_name, pid = name_map[cand_clean]
            scored.append((original_name, pid, score))

    if not scored:
        return {"status": "NOT_FOUND", "cluster": "product", "results": []}

    scored.sort(key=lambda x: x[2], reverse=True)

    # -- Stage 4: fetch full records from Neo4j
    results = []
    seen: set[str] = set()

    for original_name, pid, score in scored[: MAX_VARIANTS + 1]:
        key = original_name.lower()
        if key in seen:
            continue
        seen.add(key)

        record = neo4j_client.get_product_by_name(original_name)
        if not record:
            continue

        nutrition = {
            display_key: record.get(neo4j_key)
            for neo4j_key, display_key in PRODUCT_FIELD_MAP.items()
            if record.get(neo4j_key) is not None
        }

        results.append({
            "product_name": record.get("name", original_name),
            "brand":        record.get("brand") or record.get("brand_node"),
            "category":     record.get("category") or record.get("category_node"),
            "confidence":   round(min(score / 100, 0.95), 4),
            "nutrition":    nutrition,
            "nutriscore":   record.get("nutriscore_grade"),
            "nova_group":   record.get("nova_group"),
            "serving_size": record.get("serving_size"),
            "image_url":    record.get("image_url"),
            "meta": {
                "id":               record.get("id"),
                "nutriscore_grade": record.get("nutriscore_grade"),
                "nova_group":       record.get("nova_group"),
            },
            "cluster": "product",
        })

    if not results:
        return {"status": "NOT_FOUND", "cluster": "product", "results": []}

    return {"status": "FOUND", "cluster": "product", "results": results}
