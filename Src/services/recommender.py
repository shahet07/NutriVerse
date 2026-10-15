"""
Phase 6.5 / 6.6 — Content-Based Recommender Engine.

Architecture
------------
Taste profile:
    For each authenticated user, we collect every interaction
    (COOKED / LIKED / VIEWED / DISLIKED) that has a stored embedding
    on the target item and compute a single 384-dim weighted-average
    vector:

        profile = normalize(
            Σ  weight(rel_type) × recency_decay(rel.at) × item.embedding
        )

    Signal weights:
        COOKED   →  +3.0 × (rating / 3.0 if rated, else 1.0)
        LIKED    →  +2.0
        VIEWED   →  +0.5 (× log(view_count) bonus, capped 1.5)
        DISLIKED →  −1.5  (push profile away from this item)

    Recency decay:
        weight *= exp(−DECAY_LAMBDA × days_since_interaction)
        DECAY_LAMBDA = 0.01  →  item interacted 70 days ago has ~50% weight.

Hybrid blending (Phase 6.6):
    personalization_weight = min(1.0, positive_count / BLEND_FULL_WEIGHT_AT)
    - 0 positive interactions → pure popular (cold_start=True)
    - BLEND_FULL_WEIGHT_AT+ → pure personalized (cold_start=False)
    - In between → blended mix (cold_start=True, partial personalization)

Search-intent seeding (Phase 6.6):
    In cold/low-signal state, recent search queries are embedded via
    all-MiniLM-L6-v2 and used to re-rank popular candidates.

Diversity (MMR):
    Maximal Marginal Relevance balances relevance against redundancy:
        score(c) = λ × cosine(profile, c)
                 − (1−λ) × max cosine(c, already_selected)
    λ = 0.6 (slightly favour relevance over diversity).
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

INTERACTION_WEIGHTS: Dict[str, float] = {
    "COOKED": 3.0,
    "LIKED": 2.0,
    "VIEWED": 0.5,
    "DISLIKED": -1.5,
}

COLD_START_THRESHOLD = 5   # raised from 3; min positive interactions before personalization
BLEND_FULL_WEIGHT_AT = 8   # interactions needed for 100% personalized blend
DECAY_LAMBDA = 0.01        # per-day exponential decay (≈50% weight after 70 days)
MMR_LAMBDA = 0.6           # trade-off: 1.0 = pure relevance, 0.0 = pure diversity
EMBEDDING_DIM = 384        # all-MiniLM-L6-v2 dimensionality


# ── Helpers ────────────────────────────────────────────────────────────────

def _cosine(v1: np.ndarray, v2: np.ndarray) -> float:
    """Numerically stable cosine similarity between two 1-D arrays."""
    n1 = np.linalg.norm(v1)
    n2 = np.linalg.norm(v2)
    if n1 < 1e-10 or n2 < 1e-10:
        return 0.0
    return float(np.dot(v1, v2) / (n1 * n2))


def _neo4j_dt_to_python(neo4j_dt) -> Optional[datetime]:
    """Convert a neo4j.time.DateTime to a timezone-aware Python datetime."""
    if neo4j_dt is None:
        return None
    try:
        native = neo4j_dt.to_native()
        if native.tzinfo is None:
            native = native.replace(tzinfo=timezone.utc)
        return native
    except Exception:
        return None


# ── Service ────────────────────────────────────────────────────────────────

class RecommenderService:
    """
    Content-based recommender with hybrid cold-start blending.

    Parameters
    ----------
    neo4j_client :
        Instance of ``Src.neo4j_client.Neo4jClient``.
    embedding_model : optional
        SentenceTransformer instance for search-intent seeding.
        If None, search seeding is disabled.
    """

    def __init__(self, neo4j_client, embedding_model=None) -> None:
        self._client = neo4j_client
        self._embedding_model = embedding_model

    # ── Public API ─────────────────────────────────────────────────────────

    def compute_taste_profile(self, uid: str) -> Optional[np.ndarray]:
        """
        Build a normalized 384-dim taste profile vector from the user's
        interaction history.  Returns *None* when the user has too few
        positive interactions to produce a meaningful profile.
        """
        interactions = self._client.get_user_interactions(uid)

        positive_count = sum(
            1 for i in interactions
            if INTERACTION_WEIGHTS.get(i.get("rel_type", ""), 0) > 0
        )
        if positive_count < COLD_START_THRESHOLD:
            logger.info(
                "[Recommender] uid=%s — cold-start (positive interactions: %d < %d)",
                uid, positive_count, COLD_START_THRESHOLD,
            )
            return None

        return self._build_taste_profile(interactions)

    def get_recommendations(
        self,
        uid: str,
        cluster: str = "all",
        limit: int = 10,
    ) -> Tuple[List[Dict[str, Any]], bool]:
        """
        Return ``(items, is_cold_start)`` with hybrid blending.

        Parameters
        ----------
        uid     : Firebase user uid.
        cluster : ``"all"`` | ``"recipe"`` | ``"product"``
        limit   : How many items to return.

        Returns
        -------
        items        : List of recommendation dicts (embedding stripped).
        is_cold_start: True when falling back to popularity-based or blended results.
        """
        interactions = self._client.get_user_interactions(uid)
        positive_count = sum(
            1 for i in interactions
            if INTERACTION_WEIGHTS.get(i.get("rel_type", ""), 0) > 0
        )

        personalization_weight = min(1.0, positive_count / BLEND_FULL_WEIGHT_AT)
        taste_profile = self._build_taste_profile(interactions) if positive_count > 0 else None

        logger.info(
            "[Recommender] uid=%s — positive=%d, personalization=%.2f",
            uid, positive_count, personalization_weight,
        )

        # ── Pure cold-start ─────────────────────────────────────────────
        if personalization_weight == 0.0 or taste_profile is None:
            raw = self._client.get_popular_items(
                uid=uid, cluster=cluster, limit=max(limit * 3, 30)
            )
            # Re-rank by search-intent seed if model is available
            search_seed = self._get_search_seed(uid)
            if search_seed is not None and raw:
                for c in raw:
                    emb = c.get("embedding")
                    c["_seed_score"] = (
                        _cosine(search_seed, np.array(emb, dtype=float)) if emb else 0.0
                    )
                raw.sort(key=lambda x: x.get("_seed_score", 0.0), reverse=True)
                for c in raw:
                    c.pop("_seed_score", None)

            candidates = self._strip_embeddings(raw[:limit])
            logger.info(
                "[Recommender] uid=%s — %d cold-start (cluster=%s).",
                uid, len(candidates), cluster,
            )
            return candidates, True

        # ── Pure personalized ───────────────────────────────────────────
        if personalization_weight >= 1.0:
            raw = self._client.get_allergen_safe_candidates(
                uid=uid, cluster=cluster, limit=max(limit * 10, 100)
            )
            if not raw:
                fallback = self._client.get_popular_items(
                    uid=uid, cluster=cluster, limit=limit
                )
                return self._strip_embeddings(fallback), True

            for c in raw:
                emb = c.get("embedding")
                c["_rec_score"] = (
                    _cosine(taste_profile, np.array(emb, dtype=float)) if emb else 0.0
                )
                c["_emb"] = emb
            raw.sort(key=lambda x: x["_rec_score"], reverse=True)
            picked = self._mmr(raw, taste_profile, limit=limit)
            candidates = self._strip_embeddings(picked)
            logger.info(
                "[Recommender] uid=%s — %d personalized (cluster=%s).",
                uid, len(candidates), cluster,
            )
            return candidates, False

        # ── Hybrid blend ────────────────────────────────────────────────
        personal_n = max(1, round(limit * personalization_weight))
        popular_n = limit - personal_n

        # Personalized portion
        raw_personal = self._client.get_allergen_safe_candidates(
            uid=uid, cluster=cluster, limit=max(personal_n * 10, 80)
        )
        personal_items: List[Dict[str, Any]] = []
        if raw_personal:
            for c in raw_personal:
                emb = c.get("embedding")
                c["_rec_score"] = (
                    _cosine(taste_profile, np.array(emb, dtype=float)) if emb else 0.0
                )
                c["_emb"] = emb
            raw_personal.sort(key=lambda x: x["_rec_score"], reverse=True)
            personal_items = self._strip_embeddings(
                self._mmr(raw_personal, taste_profile, limit=personal_n)
            )

        # Popular portion (deduplicated against personalized results)
        personal_ids = {str(it.get("id", "")) for it in personal_items}
        raw_popular = self._client.get_popular_items(
            uid=uid, cluster=cluster, limit=max(popular_n * 3, 30)
        )
        popular_items = self._strip_embeddings(
            [it for it in raw_popular if str(it.get("id", "")) not in personal_ids][:popular_n]
        )

        # Popular first (discovery), then personalized
        candidates = popular_items + personal_items
        logger.info(
            "[Recommender] uid=%s — hybrid: %d popular + %d personal (cluster=%s).",
            uid, len(popular_items), len(personal_items), cluster,
        )
        return candidates, True

    # ── Taste profile builder ───────────────────────────────────────────────

    def _build_taste_profile(self, interactions: List[Dict[str, Any]]) -> Optional[np.ndarray]:
        """Build normalized taste profile from a list of interaction dicts."""
        now = datetime.now(timezone.utc)
        weighted_sum = np.zeros(EMBEDDING_DIM, dtype=float)
        total_abs_weight = 0.0

        for interaction in interactions:
            embedding = interaction.get("embedding")
            if not embedding:
                continue

            rel_type = interaction.get("rel_type", "VIEWED")
            base_weight = INTERACTION_WEIGHTS.get(rel_type, 0.5)

            # Rating-weighted COOKED (Phase 6.6)
            if rel_type == "COOKED":
                rating = interaction.get("rating")
                if rating is not None:
                    base_weight = base_weight * (rating / 3.0)

            # Recency decay
            at_python = _neo4j_dt_to_python(interaction.get("at"))
            if at_python:
                days_ago = max(0, (now - at_python).days)
                decay = math.exp(-DECAY_LAMBDA * days_ago)
            else:
                decay = 1.0

            # View-count bonus for VIEWED (multiple visits = stronger signal)
            if rel_type == "VIEWED":
                view_count = interaction.get("view_count") or 1
                base_weight = min(base_weight * math.log1p(view_count), 1.5)

            weight = base_weight * decay
            emb_arr = np.array(embedding, dtype=float)
            weighted_sum += weight * emb_arr
            total_abs_weight += abs(weight)

        if total_abs_weight < 1e-10:
            return None

        profile = weighted_sum / total_abs_weight
        norm = np.linalg.norm(profile)
        if norm > 1e-10:
            profile /= norm

        return profile

    # ── Search-intent seeding ───────────────────────────────────────────────

    def _get_search_seed(self, uid: str) -> Optional[np.ndarray]:
        """
        Build a seed vector from the user's recent search queries.
        Returns None if embedding model unavailable or no searches found.
        """
        if self._embedding_model is None:
            return None
        try:
            queries = self._client.get_user_recent_searches(uid, limit=10)
            if not queries:
                return None
            # Embed and weight by recency (most recent = highest weight)
            embeddings = self._embedding_model.encode(queries, show_progress_bar=False)
            weights = np.array([1.0 / (i + 1) for i in range(len(queries))], dtype=float)
            weights /= weights.sum()
            seed = np.average(embeddings, axis=0, weights=weights)
            norm = np.linalg.norm(seed)
            if norm > 1e-10:
                seed /= norm
            return seed.astype(float)
        except Exception as exc:
            logger.warning("[Recommender] Search seed failed: %s", exc)
            return None

    # ── MMR ────────────────────────────────────────────────────────────────

    def _mmr(
        self,
        candidates: List[Dict[str, Any]],
        query_vec: np.ndarray,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """
        Maximal Marginal Relevance re-ranking for diversity.

        Iteratively picks the candidate that maximises:
            MMR(c) = λ × relevance(c)
                   − (1−λ) × max_{s in selected} cosine(c, s)
        """
        if not candidates:
            return []

        remaining = list(candidates)
        selected: List[Dict[str, Any]] = []
        selected_vecs: List[np.ndarray] = []

        while remaining and len(selected) < limit:
            if not selected:
                best = max(remaining, key=lambda x: x.get("_rec_score", 0.0))
            else:
                best = None
                best_mmr = -float("inf")

                for c in remaining:
                    relevance = c.get("_rec_score", 0.0)
                    emb = c.get("_emb")

                    if emb is not None and selected_vecs:
                        c_vec = np.array(emb, dtype=float)
                        max_sim = max(_cosine(c_vec, sv) for sv in selected_vecs)
                    else:
                        max_sim = 0.0

                    mmr_score = MMR_LAMBDA * relevance - (1 - MMR_LAMBDA) * max_sim
                    if mmr_score > best_mmr:
                        best_mmr = mmr_score
                        best = c

                if best is None:
                    break

            emb = best.get("_emb")
            if emb is not None:
                selected_vecs.append(np.array(emb, dtype=float))

            selected.append(best)
            remaining.remove(best)

        return selected

    # ── Utility ────────────────────────────────────────────────────────────

    @staticmethod
    def _strip_embeddings(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove internal scoring fields before returning to the caller."""
        for item in items:
            item.pop("embedding", None)
            item.pop("_emb", None)
            item.pop("_rec_score", None)
            item.pop("popularity", None)
        return items
