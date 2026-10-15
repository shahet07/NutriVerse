from __future__ import annotations

import logging
from typing import Optional

from Src.neo4j_client import Neo4jClient

logger = logging.getLogger(__name__)

_client: Optional[Neo4jClient] = None


def init() -> None:
    global _client
    _client = Neo4jClient()
    stats = _client.get_stats()
    logger.info(
        "Neo4j connected — Recipes: %s, Ingredients: %s, ImageClasses: %s",
        stats.get("recipes"),
        stats.get("ingredients"),
        stats.get("image_classes"),
    )


def close() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
        logger.info("Neo4j client closed.")


def get_neo4j_client() -> Neo4jClient:
    if _client is None:
        raise RuntimeError("Neo4j client is not initialized.")
    return _client
