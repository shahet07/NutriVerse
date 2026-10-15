"""
Phase 6.5 — Dependency injection factory for RecommenderService.

Initialized during FastAPI startup (lifespan) alongside the other singletons.
"""
from __future__ import annotations

import logging
from typing import Optional

from Src.services.recommender import RecommenderService

logger = logging.getLogger(__name__)

_service: Optional[RecommenderService] = None


def init(neo4j_client, embedding_model=None) -> None:
    global _service
    _service = RecommenderService(neo4j_client=neo4j_client, embedding_model=embedding_model)
    logger.info("RecommenderService ready (search_seeding=%s).", embedding_model is not None)


def get_recommender_service() -> RecommenderService:
    if _service is None:
        raise RuntimeError("RecommenderService is not initialized.")
    return _service
