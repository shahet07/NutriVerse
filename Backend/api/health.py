import logging

from fastapi import APIRouter, Depends, HTTPException

from Backend.core.config import settings
from Backend.dependencies.neo4j import get_neo4j_client
from Backend.dependencies.model import get_image_model
from Backend.schemas.health import HealthResponse

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def health_check(
    neo4j_client=Depends(get_neo4j_client),
    image_model=Depends(get_image_model),
):
    try:
        stats = neo4j_client.get_stats()
    except Exception as exc:
        logger.error("Health check — Neo4j error: %s", exc)
        raise HTTPException(status_code=503, detail="Neo4j unavailable.")

    return HealthResponse(
        status="ok",
        recipes=stats.get("recipes", 0),
        ingredients=stats.get("ingredients", 0),
        image_classes=stats.get("image_classes", 0),
        food_products=stats.get("food_products", 0),
        brands=stats.get("brands", 0),
        categories=stats.get("categories", 0),
        allergen_tags=stats.get("allergen_tags", 0),
        image_model_loaded=image_model is not None,
        num_classes=image_model.num_classes,
    )


@router.get("/config", tags=["Health"])
async def app_config():
    """Return runtime configuration consumed by the React frontend.

    The most important field is ``remote_base_url``: the publicly reachable
    base URL of this server.  The P2P Kitchen Remote feature encodes this into
    a QR code so a phone on a different network can reach the app.

    How it is set:
    - Local ngrok testing  → set ``PUBLIC_URL=https://<id>.ngrok-free.app`` in ``.env``
    - Production           → set ``PUBLIC_URL=https://yourdomain.com`` in the host env
    - Plain localhost dev  → leave unset; the frontend falls back to
                             ``window.location.origin`` automatically.
    """
    return {
        "remote_base_url": settings.public_url or "",
        # Expose a simple deployment mode hint so the frontend/docs can
        # communicate this to users (not used for logic, purely informational).
        "deployment": "production" if settings.public_url else "local",
    }
