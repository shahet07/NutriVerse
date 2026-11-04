from __future__ import annotations

import logging
from typing import Optional

from Src.LLM.groq_client import GroqLLMClient
from Src.LLM.llm_client import OllamaLLMClient
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

    # Single client for all LLM calls (voice, chat, processing, chef).
    # Groq when a key is configured, otherwise a local Ollama model, so the
    # app still starts on a machine without cloud credentials.
    if settings.groq_api_key:
        inner = GroqLLMClient(api_key=settings.groq_api_key, model=settings.groq_model)
        llm_name = f"Groq ({settings.groq_model})"
    else:
        inner = OllamaLLMClient(model=settings.ollama_model)
        llm_name = f"Ollama ({settings.ollama_model})"
        logger.warning("GROQ_API_KEY not set: using local %s.", llm_name)
    llm_client = CachedLLMClient(inner)

    llm_engine = LLMEngine(llm_client)
    _router = NutriSenseRouter(
        neo4j_client=neo4j_client,
        llm_engine=llm_engine,
        image_model=image_model,
        graph_rag_service=graph_rag_service,
        voice_llm=llm_client,
    )
    logger.info("NutriSenseRouter initialized: %s for all LLM calls.", llm_name)


def get_router() -> NutriSenseRouter:
    if _router is None:
        raise RuntimeError("Router is not initialized.")
    return _router
