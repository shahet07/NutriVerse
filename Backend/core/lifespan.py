import os
import logging
import pathlib
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI

# Load .env early — uvicorn's reload=True spawns a child process that
# re-imports this module, so run.py's load_dotenv() alone isn't enough.
load_dotenv(pathlib.Path(__file__).resolve().parents[2] / ".env")

from Backend.core.config import settings  # noqa: E402
from Backend.dependencies import neo4j as neo4j_dep  # noqa: E402
from Backend.dependencies import model as model_dep  # noqa: E402
from Backend.dependencies import router as router_dep  # noqa: E402
from Backend.dependencies import graph_rag as graph_rag_dep  # noqa: E402
from Backend.dependencies import recommender as recommender_dep  # noqa: E402

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting NutriVerse backend...")

    os.makedirs(settings.upload_dir, exist_ok=True)
    logger.info("Upload directory ready: %s", settings.upload_dir)

    neo4j_dep.init()
    # Create indexes/constraints for efficient interaction tracking (idempotent)
    try:
        neo4j_dep.get_neo4j_client().ensure_indexes()
        logger.info("Neo4j indexes verified / created.")
    except Exception as exc:
        logger.warning("Non-fatal: could not ensure Neo4j indexes: %s", exc)
    model_dep.init()

    # Phase 3 — GraphRAG: initialise embedding model + vector search service
    graph_rag_dep.init(neo4j_dep.get_neo4j_client())

    # Phase 6.5 — Recommender engine (shares embedding model from GraphRAGService)
    recommender_dep.init(
        neo4j_dep.get_neo4j_client(),
        embedding_model=graph_rag_dep.get_graph_rag_service()._model,
    )

    router_dep.init()

    # Pre-warm Whisper STT model so the first voice command isn't delayed
    # by a cold model load (downloading + loading ~76 MB takes 1-3 min on CPU).
    if os.getenv("STT_BACKEND", "faster-whisper") == "faster-whisper":
        try:
            from Backend.api.voice_stream import _get_whisper_model
            await _get_whisper_model()
            logger.info("Whisper STT model pre-warmed.")
        except Exception as exc:
            logger.warning("Whisper pre-warm failed (non-fatal): %s", exc)

    logger.info("Startup complete. Ready to serve requests.")

    yield

    # Shutdown
    logger.info("Shutting down NutriVerse backend...")
    neo4j_dep.close()
    logger.info("Shutdown complete.")
