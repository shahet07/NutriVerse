"""
Phase 3 — GraphRAG Hybrid Search Service.

GraphRAGService combines two retrieval signals:
  1. **Vector similarity** — `all-MiniLM-L6-v2` embeddings stored on each
     Recipe / FoodProduct node, queried via the Neo4j vector index.
  2. **Graph constraint filtering & boosting** — HealthTag and AllergenTag
     graph edges are used to filter out unsafe items and boost items that
     match the user's requested health goals.

Public API
----------
    service = GraphRAGService(neo4j_client, model)

    results = service.search(
        query      = "something high protein and low calorie",
        cluster    = "all",           # "all" | "recipe" | "product"
        limit      = 10,
        health_tags      = ["High Protein"],   # optional include filter
        exclude_allergens= ["Dairy", "Gluten"],# optional exclude filter
    )

Each result dict contains:
    {
        "id":          str,
        "name":        str,
        "cluster":     "recipe" | "product",
        "vector_score": float,     # cosine similarity [0, 1]
        "graph_score":  float,     # health-tag match ratio [0, 1]
        "final_score":  float,     # 0.7 * vector + 0.3 * graph
        ...all node properties...
    }

Fallback
--------
If the vector index does not exist (e.g. `generate_embeddings.py` hasn't
been run yet) the service transparently falls back to full-text search via
`db.index.fulltext.queryNodes`.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Re-ranking weights
VECTOR_WEIGHT = 0.7
GRAPH_WEIGHT  = 0.3

# Number of candidates fetched from each cluster before re-ranking
CANDIDATE_MULTIPLIER = 5   # fetch limit*5 candidates, re-rank, return top limit

# ── Health-tag keyword mapping ─────────────────────────────────────
# Maps user-query keywords to HealthTag node names in Neo4j.
# When a query contains any of these patterns, the corresponding tag
# is auto-applied as a SUITABLE_FOR filter so the graph does the heavy
# lifting instead of relying solely on vector/text similarity.
_HEALTH_TAG_KEYWORDS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"\bhigh\s*protein\b", re.I), "High Protein"),
    (re.compile(r"\bprotein[- ]?rich\b", re.I), "High Protein"),
    (re.compile(r"\blow\s*cal(?:orie)?\b", re.I), "Low Calorie"),
    (re.compile(r"\blight\b", re.I), "Low Calorie"),
    (re.compile(r"\bketo\b", re.I), "Keto"),
    (re.compile(r"\bketogenic\b", re.I), "Keto"),
    (re.compile(r"\bdiabetic\b", re.I), "Diabetic Friendly"),
    (re.compile(r"\bsugar[- ]?free\b", re.I), "Diabetic Friendly"),
    (re.compile(r"\bvegan\b", re.I), "Vegan"),
    (re.compile(r"\bplant[- ]?based\b", re.I), "Vegan"),
    (re.compile(r"\bgluten[- ]?free\b", re.I), "Gluten Free"),
    (re.compile(r"\bpaleo\b", re.I), "Paleo"),
]


def _extract_health_tags(query: str) -> List[str]:
    """Return deduplicated list of HealthTag names detected in *query*."""
    tags: List[str] = []
    for pattern, tag in _HEALTH_TAG_KEYWORDS:
        if pattern.search(query) and tag not in tags:
            tags.append(tag)
    return tags


class GraphRAGService:
    """Hybrid GraphRAG search over Recipe + FoodProduct clusters."""

    def __init__(self, neo4j_client, embedding_model=None):
        """
        Parameters
        ----------
        neo4j_client :
            Instance of ``Src.neo4j_client.Neo4jClient``.
        embedding_model :
            A ``sentence_transformers.SentenceTransformer`` instance.
            If *None* the service falls back to full-text search.
        """
        self._client = neo4j_client
        self._model  = embedding_model
        self._vector_ready: Optional[bool] = None   # lazily checked

    # ── Public search method ───────────────────────────────────────────────

    def search(
        self,
        query: str,
        cluster: str = "all",
        limit: int = 10,
        health_tags: Optional[List[str]] = None,
        exclude_allergens: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Run hybrid retrieval and return *limit* ranked results.

        Parameters
        ----------
        query              : Natural language search string.
        cluster            : "all" | "recipe" | "product"
        limit              : Maximum results to return.
        health_tags        : Only return nodes tagged SUITABLE_FOR ALL of these.
        exclude_allergens  : Remove nodes that contain any of these AllergenTags.
        """
        cluster = cluster.lower()
        if cluster not in {"all", "recipe", "product"}:
            cluster = "all"

        # Auto-detect health tags from the natural-language query and merge
        # them with any explicitly provided tags so that queries like
        # "high protein breakfast" leverage SUITABLE_FOR graph edges.
        detected_tags = _extract_health_tags(query)
        if detected_tags:
            merged: List[str] = list(health_tags) if health_tags else []
            for t in detected_tags:
                if t not in merged:
                    merged.append(t)
            health_tags = merged
            logger.info("[GraphRAG] Auto-detected health tags from query: %s", detected_tags)

        candidates_limit = limit * CANDIDATE_MULTIPLIER

        use_vector = self._check_vector_ready()

        if use_vector and self._model is not None:
            query_vector = self._encode(query)
            recipe_raw   = (self._vector_recipe_search(query_vector, candidates_limit)
                            if cluster in {"all", "recipe"} else [])
            product_raw  = (self._vector_product_search(query_vector, candidates_limit)
                            if cluster in {"all", "product"} else [])
        else:
            logger.info(
                "[GraphRAG] Vector index not ready — falling back to full-text search."
            )
            recipe_raw  = (self._fts_recipe_search(query, candidates_limit)
                           if cluster in {"all", "recipe"} else [])
            product_raw = (self._fts_product_search(query, candidates_limit)
                           if cluster in {"all", "product"} else [])

        # Tag each record with its cluster
        for r in recipe_raw:
            r["cluster"] = "recipe"
        for p in product_raw:
            p["cluster"] = "product"

        combined = recipe_raw + product_raw

        # Apply graph filters
        combined = self._apply_allergen_filter(combined, exclude_allergens)
        combined = self._apply_health_tag_filter(combined, health_tags)

        # Re-rank
        combined = self._rerank(combined, health_tags)

        # ── Balanced cluster return ────────────────────────────────────
        # When searching "all", products often dominate because their
        # names literally contain keywords (e.g. "High Protein Oats")
        # yielding higher vector scores.  We guarantee each cluster a
        # fair share of the limit so users always see both food types.
        if cluster == "all":
            return self._balanced_return(combined, limit)

        return combined[:limit]

    async def search_async(
        self,
        query: str,
        cluster: str = "all",
        limit: int = 10,
        health_tags: Optional[List[str]] = None,
        exclude_allergens: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Async wrapper — runs the synchronous search in a thread pool."""
        return await asyncio.to_thread(
            self.search,
            query, cluster, limit, health_tags, exclude_allergens,
        )

    # ── Vector search ──────────────────────────────────────────────────────

    def _encode(self, text: str) -> List[float]:
        vec = self._model.encode(text, normalize_embeddings=True)
        return vec.tolist()

    def _vector_recipe_search(self, query_vector: List[float], limit: int) -> List[Dict]:
        with self._client.driver.session() as session:
            result = session.run(
                """
                CALL db.index.vector.queryNodes('recipe_embedding', $limit, $vector)
                YIELD node, score
                RETURN
                    node.id AS id,
                    node.name AS name,
                    node.food_name AS food_name,
                    node.serving_size_g AS serving_size_g,
                    node.prep_time_mins AS prep_time_mins,
                    node.instructions AS instructions,
                    node.raw_ingredients AS raw_ingredients,
                    node.calories AS calories,
                    node.carbohydrates AS carbohydrates,
                    node.protein AS protein,
                    node.fats AS fats,
                    node.fibre AS fibre,
                    node.sodium AS sodium,
                    node.calcium AS calcium,
                    node.iron AS iron,
                    node.vitamin_c AS vitamin_c,
                    node.folate AS folate,
                    node.free_sugar AS free_sugar,
                    score AS vector_score
                ORDER BY score DESC
                """,
                vector=query_vector, limit=limit,
            )
            return [dict(r) for r in result]

    def _vector_product_search(self, query_vector: List[float], limit: int) -> List[Dict]:
        with self._client.driver.session() as session:
            result = session.run(
                """
                CALL db.index.vector.queryNodes('product_embedding', $limit, $vector)
                YIELD node, score
                OPTIONAL MATCH (node)-[:MADE_BY]->(b:Brand)
                OPTIONAL MATCH (node)-[:IN_CATEGORY]->(cat:Category)
                RETURN
                    node.id AS id,
                    node.name AS name,
                    node.generic_name AS generic_name,
                    node.brand AS brand,
                    node.category AS category,
                    node.serving_size AS serving_size,
                    node.nova_group AS nova_group,
                    node.nutriscore_grade AS nutriscore_grade,
                    node.calories_100g AS calories_100g,
                    node.fat_100g AS fat_100g,
                    node.carbohydrates_100g AS carbohydrates_100g,
                    node.sugars_100g AS sugars_100g,
                    node.fiber_100g AS fiber_100g,
                    node.proteins_100g AS proteins_100g,
                    node.sodium_100g AS sodium_100g,
                    node.image_url AS image_url,
                    b.name AS brand_node,
                    cat.name AS category_node,
                    score AS vector_score
                ORDER BY score DESC
                """,
                vector=query_vector, limit=limit,
            )
            return [dict(r) for r in result]

    # ── Full-text fallback search ──────────────────────────────────────────

    def _fts_recipe_search(self, query: str, limit: int) -> List[Dict]:
        rows = self._client.search_recipes_by_name(query, limit=limit)
        for r in rows:
            # search_recipes_by_name returns 'recipe_original' for the name field;
            # rename to 'name' so it matches the SearchResult schema.
            if "recipe_original" in r and "name" not in r:
                r["name"] = r.pop("recipe_original")
            elif "recipe_original" in r:
                r.pop("recipe_original")
            # Normalise score: Neo4j FTS scores are unbounded, cap at 1.0
            r["vector_score"] = min(r.pop("search_score", 0.0) / 10.0, 1.0)
        return rows

    def _fts_product_search(self, query: str, limit: int) -> List[Dict]:
        rows = self._client.search_products_by_name(query, limit=limit)
        for r in rows:
            r["vector_score"] = min(r.pop("search_score", 0.0) / 10.0, 1.0)
        return rows

    # ── Graph filtering ────────────────────────────────────────────────────

    def _apply_allergen_filter(
        self, records: List[Dict], exclude_allergens: Optional[List[str]]
    ) -> List[Dict]:
        """Remove any records that contain excluded allergens."""
        if not exclude_allergens:
            return records

        keep = []
        with self._client.driver.session() as session:
            for r in records:
                label = "Recipe" if r.get("cluster") == "recipe" else "FoodProduct"
                result = session.run(
                    f"""
                    MATCH (n:{label} {{id: $id}})
                    -[:CONTAINS]->(i:Ingredient)
                    -[:IS_ALLERGEN]->(a:AllergenTag)
                    WHERE a.name IN $allergens
                    RETURN count(*) AS hits
                    """,
                    id=r["id"], allergens=exclude_allergens,
                ).single()
                if result and result["hits"] == 0:
                    keep.append(r)
                elif result is None:
                    keep.append(r)   # node has no allergen info — include by default
        return keep

    def _apply_health_tag_filter(
        self, records: List[Dict], health_tags: Optional[List[str]]
    ) -> List[Dict]:
        """Keep only records that match ALL of the requested health tags.

        Uses batched Cypher queries (one per cluster) instead of per-node
        lookups for dramatically better performance.
        """
        if not health_tags:
            return records

        num_required = len(health_tags)

        # Split by cluster for label-specific queries
        recipe_records  = [r for r in records if r.get("cluster") == "recipe"]
        product_records = [r for r in records if r.get("cluster") == "product"]

        # Build {id → record} mappings and collect ids for batch query
        recipe_by_id  = {r["id"]: r for r in recipe_records}
        product_by_id = {r["id"]: r for r in product_records}

        keep = []
        with self._client.driver.session() as session:
            # Batch: recipes
            if recipe_by_id:
                rows = session.run(
                    """
                    UNWIND $ids AS nid
                    OPTIONAL MATCH (n:Recipe {id: nid})-[:SUITABLE_FOR]->(ht:HealthTag)
                    WHERE ht.name IN $tags
                    RETURN nid AS id, count(DISTINCT ht.name) AS matched
                    """,
                    ids=list(recipe_by_id.keys()), tags=health_tags,
                ).data()
                for row in rows:
                    rec = recipe_by_id.get(row["id"])
                    if rec:
                        rec["_tag_matched"] = row["matched"]
                        if row["matched"] >= num_required:
                            keep.append(rec)

            # Batch: products
            if product_by_id:
                rows = session.run(
                    """
                    UNWIND $ids AS nid
                    OPTIONAL MATCH (n:FoodProduct {id: nid})-[:SUITABLE_FOR]->(ht:HealthTag)
                    WHERE ht.name IN $tags
                    RETURN nid AS id, count(DISTINCT ht.name) AS matched
                    """,
                    ids=list(product_by_id.keys()), tags=health_tags,
                ).data()
                for row in rows:
                    rec = product_by_id.get(row["id"])
                    if rec:
                        rec["_tag_matched"] = row["matched"]
                        if row["matched"] >= num_required:
                            keep.append(rec)

        return keep

    # ── Re-ranking ─────────────────────────────────────────────────────────

    def _rerank(
        self, records: List[Dict], health_tags: Optional[List[str]]
    ) -> List[Dict]:
        """
        Compute final_score = VECTOR_WEIGHT * vector_score
                             + GRAPH_WEIGHT  * graph_score

        graph_score is the ratio of requested health tags matched by the node.
        If no health_tags were requested, graph_score defaults to 1.0 for all.
        """
        num_tags = len(health_tags) if health_tags else 0

        for r in records:
            vec_score = float(r.get("vector_score") or 0.0)
            if num_tags > 0:
                matched = float(r.pop("_tag_matched", 0))
                graph_score = matched / num_tags
            else:
                r.pop("_tag_matched", None)
                graph_score = 1.0

            r["vector_score"] = round(vec_score, 4)
            r["graph_score"]  = round(graph_score, 4)
            r["final_score"]  = round(VECTOR_WEIGHT * vec_score + GRAPH_WEIGHT * graph_score, 4)

        records.sort(key=lambda x: x["final_score"], reverse=True)
        return records

    # ── Balanced cluster return ────────────────────────────────────────────

    @staticmethod
    def _balanced_return(
        ranked: List[Dict[str, Any]], limit: int
    ) -> List[Dict[str, Any]]:
        """
        Ensure both clusters get a fair share of the final result set.

        Strategy:
          - Reserve ``limit // 2`` slots for each cluster.
          - If a cluster has fewer results than its quota, redirect the
            unused slots to the other cluster.
          - Final list is re-sorted by ``final_score`` so the frontend
            can split by cluster and still see them in score order.
        """
        recipes  = [r for r in ranked if r.get("cluster") == "recipe"]
        products = [r for r in ranked if r.get("cluster") == "product"]

        half = limit // 2

        if len(recipes) >= half and len(products) >= half:
            picked = recipes[:half] + products[:half]
        elif len(recipes) < half:
            product_slots = limit - len(recipes)
            picked = recipes + products[:product_slots]
        else:
            recipe_slots = limit - len(products)
            picked = recipes[:recipe_slots] + products

        picked.sort(key=lambda x: x.get("final_score", 0), reverse=True)
        logger.info(
            "[GraphRAG] Balanced return: %d recipes, %d products (limit=%d)",
            sum(1 for r in picked if r.get("cluster") == "recipe"),
            sum(1 for r in picked if r.get("cluster") == "product"),
            limit,
        )
        return picked

    # ── Health-tag convenience ─────────────────────────────────────────────

    def get_all_health_tags(self) -> List[str]:
        """Return all HealthTag names currently in the graph."""
        with self._client.driver.session() as session:
            result = session.run("MATCH (ht:HealthTag) RETURN ht.name AS name ORDER BY name")
            return [r["name"] for r in result]

    # ── Internal helpers ───────────────────────────────────────────────────

    def _check_vector_ready(self) -> bool:
        """
        Lazily check whether the Neo4j vector indexes exist.
        Result is cached after the first call.
        """
        if self._vector_ready is not None:
            return self._vector_ready

        try:
            with self._client.driver.session() as session:
                r = session.run(
                    """
                    SHOW INDEXES
                    YIELD name, type
                    WHERE type = 'VECTOR'
                    AND name IN ['recipe_embedding', 'product_embedding']
                    RETURN count(*) AS n
                    """
                ).single()
                count = r["n"] if r else 0
                self._vector_ready = (count >= 1)
        except Exception as exc:
            logger.warning("[GraphRAG] Could not check vector indexes: %s", exc)
            self._vector_ready = False

        if not self._vector_ready:
            logger.warning(
                "[GraphRAG] Vector indexes not found. "
                "Run `python scripts/generate_embeddings.py` to build them."
            )

        return self._vector_ready
