"""
Phase 3 — Dependency injection for the GraphRAGService.

The embedding model is loaded lazily the first time `init()` is called
(during FastAPI startup). This avoids import-time latency and lets the
server start in < 1 s even when `sentence-transformers` is installed.

If `sentence-transformers` is not installed the service still starts;
it will fall back to full-text search automatically.
"""

from __future__ import annotations

import logging
from typing import Optional

from Src.services.graph_rag import GraphRAGService

logger = logging.getLogger(__name__)

_service: Optional[GraphRAGService] = None


def init(neo4j_client) -> None:
    """Initialise the GraphRAGService and load the embedding model."""
    global _service

    embedding_model = None
    try:
        from sentence_transformers import SentenceTransformer   # noqa: PLC0415
        model_name = "all-MiniLM-L6-v2"
        logger.info("Loading sentence-transformer model: %s …", model_name)
        embedding_model = SentenceTransformer(model_name)
        logger.info("Embedding model loaded (%d dims).", embedding_model.get_sentence_embedding_dimension())
    except ImportError:
        logger.warning(
            "sentence-transformers not installed — GraphRAG will use full-text fallback. "
            "Run `pip install sentence-transformers` to enable vector search."
        )
    except Exception as exc:
        logger.warning("Embedding model load failed (%s) — using full-text fallback.", exc)

    _service = GraphRAGService(neo4j_client=neo4j_client, embedding_model=embedding_model)
    logger.info(
        "GraphRAGService ready (vector_ready=%s).",
        _service._check_vector_ready(),
    )


def get_graph_rag_service() -> GraphRAGService:
    if _service is None:
        raise RuntimeError("GraphRAGService is not initialized.")
    return _service
