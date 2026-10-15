"""
Phase 6.5 — User Graph API.

All endpoints are under /users/me and require a valid Bearer access token,
except where noted.

Routes
------
GET    /users/me                          Profile + stats
GET    /users/me/allergens                Current allergen set
PUT    /users/me/allergens                Replace allergen set
GET    /users/me/allergen-tags            All available AllergenTag names
POST   /users/me/viewed/{item_id}         Log a VIEWED interaction
POST   /users/me/liked/{item_id}          Log a LIKED interaction
DELETE /users/me/liked/{item_id}          Remove a LIKED interaction
POST   /users/me/disliked/{item_id}       Log a DISLIKED interaction
DELETE /users/me/disliked/{item_id}       Remove a DISLIKED interaction
GET    /users/me/interactions             Fetch LIKED/DISLIKED state for item batch
POST   /users/me/cooked/{recipe_id}       Log a COOKED interaction
GET    /users/me/cooked                   Recently cooked recipes
GET    /users/me/recommendations          Personalized / popular recommendations
GET    /users/me/export                   GDPR data export (Article 20)
DELETE /users/me                          GDPR right to be forgotten
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse

from Backend.dependencies.auth_user import get_current_user
from Backend.dependencies.neo4j import get_neo4j_client
from Backend.dependencies.recommender import get_recommender_service
from Backend.schemas.users import (
    AllergenUpdateRequest,
    CookedItem,
    CookedRequest,
    CookedResponse,
    InteractionResponse,
    InteractionStateItem,
    InteractionStatesResponse,
    OnboardingPreferencesRequest,
    RecommendationItem,
    RecommendationResponse,
    UserProfile,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/users/me", tags=["Users"])


# ── Profile ────────────────────────────────────────────────────────────────

@router.get("", response_model=UserProfile)
async def get_profile(
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> UserProfile:
    """Return the authenticated user's profile, stats, allergens, and recent activity."""
    uid = current_user["uid"]
    try:
        profile = await asyncio.to_thread(neo4j_client.get_user_profile, uid)
    except Exception as exc:
        logger.exception("get_user_profile failed for uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Could not load profile.")

    if not profile:
        raise HTTPException(status_code=404, detail="User profile not found.")

    # Flatten neo4j datetime objects to ISO strings for Pydantic
    _serialize_datetimes(profile)

    try:
        return UserProfile(**profile)
    except Exception as exc:
        logger.exception("Profile serialization failed for uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Profile serialization error.")


# ── Allergens ─────────────────────────────────────────────────────────────

@router.get("/allergens", response_model=List[str])
async def get_allergens(
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> List[str]:
    """Return the user's current allergen set."""
    uid = current_user["uid"]
    try:
        return await asyncio.to_thread(neo4j_client.get_allergens, uid)
    except Exception as exc:
        logger.exception("get_allergens failed for uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Could not load allergens.")


@router.put("/allergens", response_model=List[str])
async def set_allergens(
    body: AllergenUpdateRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> List[str]:
    """
    Atomically replace the user's allergen set.
    Pass an empty list to clear all allergens.
    """
    uid = current_user["uid"]
    try:
        await asyncio.to_thread(neo4j_client.set_allergens, uid, body.allergens)
        return await asyncio.to_thread(neo4j_client.get_allergens, uid)
    except Exception as exc:
        logger.exception("set_allergens failed for uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Could not update allergens.")


@router.get("/allergen-tags", response_model=List[str])
async def get_all_allergen_tags(
    neo4j_client=Depends(get_neo4j_client),
) -> List[str]:
    """Return all AllergenTag names available in the knowledge graph (public)."""
    try:
        return await asyncio.to_thread(neo4j_client.get_all_allergen_tags)
    except Exception as exc:
        logger.exception("get_all_allergen_tags failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not fetch allergen tags.")


# ── Interactions ───────────────────────────────────────────────────────────

@router.post("/viewed/{item_id}", response_model=InteractionResponse)
async def log_viewed(
    item_id: str,
    cluster: str = Query("recipe", description="'recipe' or 'product'"),
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> InteractionResponse:
    """Log or increment a VIEWED interaction for the authenticated user."""
    _validate_cluster(cluster)
    uid = current_user["uid"]
    try:
        await asyncio.to_thread(neo4j_client.log_viewed, uid, item_id, cluster)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("log_viewed failed uid=%s item=%s cluster=%s: %s", uid, item_id, cluster, exc)
        raise HTTPException(status_code=500, detail=f"Could not log viewed: {type(exc).__name__}")
    return InteractionResponse(item_id=item_id, action="viewed")


@router.post("/liked/{item_id}", response_model=InteractionResponse)
async def log_liked(
    item_id: str,
    cluster: str = Query("recipe", description="'recipe' or 'product'"),
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> InteractionResponse:
    """Log a LIKED interaction; removes any existing DISLIKED relationship."""
    _validate_cluster(cluster)
    uid = current_user["uid"]
    logger.info("log_liked uid=%s item=%s cluster=%s", uid, item_id, cluster)
    try:
        await asyncio.to_thread(neo4j_client.log_liked, uid, item_id, cluster)
    except ValueError as exc:
        logger.warning("log_liked item not found uid=%s item=%s cluster=%s: %s", uid, item_id, cluster, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("log_liked failed uid=%s item=%s cluster=%s: %s", uid, item_id, cluster, exc)
        raise HTTPException(status_code=500, detail=f"Could not save like: {type(exc).__name__}")
    return InteractionResponse(item_id=item_id, action="liked", state="liked")


@router.delete("/liked/{item_id}", response_model=InteractionResponse)
async def remove_liked(
    item_id: str,
    cluster: str = Query("recipe", description="'recipe' or 'product'"),
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> InteractionResponse:
    """Remove a LIKED relationship (un-like)."""
    _validate_cluster(cluster)
    uid = current_user["uid"]
    try:
        await asyncio.to_thread(neo4j_client.log_unliked, uid, item_id, cluster)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("remove_liked failed uid=%s item=%s cluster=%s: %s", uid, item_id, cluster, exc)
        raise HTTPException(status_code=500, detail=f"Could not remove like: {type(exc).__name__}")
    return InteractionResponse(item_id=item_id, action="unliked", state=None)


@router.post("/disliked/{item_id}", response_model=InteractionResponse)
async def log_disliked(
    item_id: str,
    cluster: str = Query("recipe", description="'recipe' or 'product'"),
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> InteractionResponse:
    """Log a DISLIKED interaction; removes any existing LIKED relationship."""
    _validate_cluster(cluster)
    uid = current_user["uid"]
    logger.info("log_disliked uid=%s item=%s cluster=%s", uid, item_id, cluster)
    try:
        await asyncio.to_thread(neo4j_client.log_disliked, uid, item_id, cluster)
    except ValueError as exc:
        logger.warning("log_disliked item not found uid=%s item=%s cluster=%s: %s", uid, item_id, cluster, exc)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("log_disliked failed uid=%s item=%s cluster=%s: %s", uid, item_id, cluster, exc)
        raise HTTPException(status_code=500, detail=f"Could not save dislike: {type(exc).__name__}")
    return InteractionResponse(item_id=item_id, action="disliked", state="disliked")


@router.delete("/disliked/{item_id}", response_model=InteractionResponse)
async def remove_disliked(
    item_id: str,
    cluster: str = Query("recipe", description="'recipe' or 'product'"),
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> InteractionResponse:
    """Remove a DISLIKED relationship (un-dislike)."""
    _validate_cluster(cluster)
    uid = current_user["uid"]
    try:
        await asyncio.to_thread(neo4j_client.log_undisliked, uid, item_id, cluster)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.exception("remove_disliked failed uid=%s item=%s cluster=%s: %s", uid, item_id, cluster, exc)
        raise HTTPException(status_code=500, detail=f"Could not remove dislike: {type(exc).__name__}")
    return InteractionResponse(item_id=item_id, action="undisliked", state=None)


# ── User Preferences (Onboarding) ──────────────────────────────────────────

@router.post("/preferences", status_code=200)
async def set_preferences(
    body: OnboardingPreferencesRequest,
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> Dict[str, str]:
    """Store onboarding preferences: cuisine picks, health tags, and health goal."""
    uid = current_user["uid"]
    try:
        await asyncio.to_thread(
            neo4j_client.set_user_preferences,
            uid, body.cuisines, body.health_tags, body.health_goal,
        )
    except Exception as exc:
        logger.exception("set_user_preferences failed uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Could not save preferences.")
    return {"status": "ok"}


@router.get("/interactions", response_model=InteractionStatesResponse)
async def get_interaction_states(
    item: List[str] = Query(
        [],
        description=(
            "Repeatable 'cluster:id' pairs. Example: "
            "item=recipe:abc123&item=product:xyz789"
        ),
    ),
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> InteractionStatesResponse:
    """Return current liked/disliked state for a batch of items."""
    uid = current_user["uid"]

    recipe_ids: List[str] = []
    product_ids: List[str] = []
    for raw in item:
        if ":" not in raw:
            continue
        cluster, item_id = raw.split(":", 1)
        if not item_id:
            continue
        if cluster == "recipe":
            recipe_ids.append(item_id)
        elif cluster == "product":
            product_ids.append(item_id)

    if not recipe_ids and not product_ids:
        return InteractionStatesResponse(items=[])

    try:
        rows = await asyncio.to_thread(
            neo4j_client.get_user_preference_states,
            uid,
            recipe_ids,
            product_ids,
        )
    except Exception as exc:
        logger.exception("get_user_preference_states failed uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Could not load interaction states.")

    items: List[InteractionStateItem] = []
    for row in rows:
        try:
            items.append(InteractionStateItem(**row))
        except Exception as exc:
            logger.warning("Skipping malformed interaction state row: %s", exc)

    return InteractionStatesResponse(items=items)


@router.post("/cooked/{recipe_id}", response_model=InteractionResponse)
async def log_cooked(
    recipe_id: str,
    body: Optional[CookedRequest] = None,
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> InteractionResponse:
    """Log a COOKED interaction with an optional star rating (1–5)."""
    uid = current_user["uid"]
    rating = body.rating if body else None
    try:
        await asyncio.to_thread(neo4j_client.log_cooked, uid, recipe_id, rating)
    except Exception as exc:
        logger.warning("log_cooked failed uid=%s recipe=%s: %s", uid, recipe_id, exc)
    return InteractionResponse(item_id=recipe_id, action="cooked")


# ── Cooked history ─────────────────────────────────────────────────────────

@router.get("/cooked", response_model=CookedResponse)
async def get_cooked(
    limit: int = Query(8, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
) -> CookedResponse:
    """Return the user's most recently cooked recipes (for the profile page row)."""
    uid = current_user["uid"]
    try:
        raw = await asyncio.to_thread(neo4j_client.get_user_cooked, uid, limit)
    except Exception as exc:
        logger.exception("get_user_cooked failed uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Could not fetch cooked history.")

    items: List[CookedItem] = []
    for r in raw:
        _serialize_datetimes(r)
        try:
            items.append(CookedItem(**r))
        except Exception as exc:
            logger.warning("Skipping malformed cooked row: %s", exc)

    return CookedResponse(items=items, total=len(items))


# ── Recommendations ────────────────────────────────────────────────────────

@router.get("/recommendations", response_model=RecommendationResponse)
async def get_recommendations(
    cluster: str = Query("all", description="'all' | 'recipe' | 'product'"),
    limit: int = Query(10, ge=1, le=50),
    current_user: Dict[str, Any] = Depends(get_current_user),
    recommender=Depends(get_recommender_service),
    neo4j_client=Depends(get_neo4j_client),
) -> RecommendationResponse:
    """
    Return personalized recommendations for the authenticated user.

    Falls back to globally popular items (allergen-filtered) when the user
    has fewer than 3 positive interactions (cold-start state).
    """
    if cluster not in {"all", "recipe", "product"}:
        raise HTTPException(
            status_code=400,
            detail="cluster must be one of: all, recipe, product",
        )

    uid = current_user["uid"]
    try:
        raw, cold_start = await asyncio.to_thread(
            recommender.get_recommendations, uid, cluster, limit
        )
    except Exception as exc:
        logger.exception("get_recommendations failed uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Recommendation engine error.")

    items: List[RecommendationItem] = []
    for r in raw:
        _serialize_datetimes(r)
        try:
            items.append(RecommendationItem(**r))
        except Exception as exc:
            logger.warning("Skipping malformed recommendation: %s", exc)

    # Hydrate persisted like/dislike state for returned recommendation cards.
    if items:
        recipe_ids = [it.id for it in items if it.cluster == "recipe"]
        product_ids = [it.id for it in items if it.cluster == "product"]
        try:
            states = await asyncio.to_thread(
                neo4j_client.get_user_preference_states,
                uid,
                recipe_ids,
                product_ids,
            )
            state_map = {
                (row["cluster"], str(row["id"])): row["state"]
                for row in states
                if row.get("state") in {"liked", "disliked"}
            }
            for item in items:
                item.interaction_state = state_map.get((item.cluster, str(item.id)))
        except Exception as exc:
            logger.warning("Failed to hydrate recommendation states uid=%s: %s", uid, exc)

    return RecommendationResponse(
        items=items,
        cold_start=cold_start,
        cluster=cluster,
        total=len(items),
    )


# ── GDPR ───────────────────────────────────────────────────────────────────

@router.get("/export")
async def export_user_data(
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
):
    """
    GDPR Article 20 — Data portability export.
    Returns all stored user data as a JSON object.
    """
    uid = current_user["uid"]
    try:
        data = await asyncio.to_thread(neo4j_client.export_user_data, uid)
    except Exception as exc:
        logger.exception("export_user_data failed uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Data export failed.")

    _serialize_datetimes(data)
    return JSONResponse(content=data)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    current_user: Dict[str, Any] = Depends(get_current_user),
    neo4j_client=Depends(get_neo4j_client),
):
    """
    GDPR Right to be Forgotten — permanently delete the user's account and all
    associated data (interactions, search history, allergen profile).
    """
    uid = current_user["uid"]
    try:
        await asyncio.to_thread(neo4j_client.delete_user, uid)
        logger.info("User account deleted: uid=%s", uid)
    except Exception as exc:
        logger.exception("delete_user failed uid=%s: %s", uid, exc)
        raise HTTPException(status_code=500, detail="Account deletion failed.")


# ── Internal helpers ───────────────────────────────────────────────────────

def _validate_cluster(cluster: str) -> None:
    if cluster not in {"recipe", "product"}:
        raise HTTPException(
            status_code=400,
            detail="cluster must be 'recipe' or 'product'.",
        )


def _serialize_datetimes(obj: Any) -> None:
    """
    Recursively convert neo4j DateTime objects (and Python datetime) to ISO
    strings in-place so Pydantic and JSONResponse can handle them.
    """
    if isinstance(obj, dict):
        for key, value in obj.items():
            if hasattr(value, "isoformat"):
                obj[key] = value.isoformat()
            elif hasattr(value, "to_native"):
                try:
                    obj[key] = value.to_native().isoformat()
                except Exception:
                    obj[key] = str(value)
            elif isinstance(value, (dict, list)):
                _serialize_datetimes(value)
    elif isinstance(obj, list):
        for item in obj:
            _serialize_datetimes(item)
