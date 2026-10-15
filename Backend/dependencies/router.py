from __future__ import annotations

import logging
from typing import Optional

from Src.LLM.groq_client import GroqLLMClient
from Src.LLM.cached_client import CachedLLMClient
from Src.LLM.llm_engine import LLMEngine
from Src.Router.Router import NutriSenseRouter
from Backend.core.config import settings
from Backend.dependencies.neo4j import get_neo4j_client
from Backend.dependencies.model import get_image_model
from Backend.dependencies.graph_rag import get_graph_rag_service

logger = logging.getLogger(__name__)

_router: Optional[NutriSenseRouter] = None


def init() -> None:
    global _router
    neo4j_client = get_neo4j_client()
    image_model = get_image_model()
    graph_rag_service = get_graph_rag_service()

    # Single Groq client for all LLM calls (voice, chat, processing, chef).
    # Groq's free tier has no daily limits — only per-minute rate limits
    # which our CachedLLMClient + rate_limiter handle.
    llm_client = CachedLLMClient(
        GroqLLMClient(api_key=settings.groq_api_key, model=settings.groq_model)
    )

    llm_engine = LLMEngine(llm_client)
    _router = NutriSenseRouter(
        neo4j_client=neo4j_client,
        llm_engine=llm_engine,
        image_model=image_model,
        graph_rag_service=graph_rag_service,
        voice_llm=llm_client,
    )
    logger.info("NutriSenseRouter initialized — Groq (%s) for all LLM calls.", settings.groq_model)


def get_router() -> NutriSenseRouter:
    if _router is None:
        raise RuntimeError("Router is not initialized.")
    return _router
