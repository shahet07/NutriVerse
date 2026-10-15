"""Phase 6.5 — User Graph Pydantic schemas."""
from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# Recipe nodes carry integer ids (1..N) post-migration; products carry string
# barcodes. Every model below that accepts an id from either cluster opts in to
# numeric→string coercion so Pydantic v2's strict validation doesn't silently
# drop recipe rows.
_ID_COERCE_CONFIG = ConfigDict(coerce_numbers_to_str=True)


# ── Requests ──────────────────────────────────────────────────────────────

class AllergenUpdateRequest(BaseModel):
    allergens: List[str] = Field(
        default_factory=list,
        description="Full replacement list of AllergenTag names. "
                    "Pass an empty list to clear all allergens.",
    )


class CookedRequest(BaseModel):
    rating: Optional[int] = Field(
        None,
        ge=1,
        le=5,
        description="Optional star rating 1–5.",
    )


# ── Response fragments ────────────────────────────────────────────────────

class InteractionResponse(BaseModel):
    status: str = "ok"
    item_id: str
    action: str
    state: Optional[Literal["liked", "disliked"]] = None


class OnboardingPreferencesRequest(BaseModel):
    cuisines: List[str] = Field(default_factory=list)
    health_tags: List[str] = Field(default_factory=list)
    health_goal: Optional[str] = None


class InteractionStateItem(BaseModel):
    model_config = _ID_COERCE_CONFIG
    id: str
    cluster: Literal["recipe", "product"]
    state: Literal["liked", "disliked"]


class InteractionStatesResponse(BaseModel):
    items: List[InteractionStateItem] = Field(default_factory=list)


class RecentSearch(BaseModel):
    query: str
    cluster: Optional[str] = None
    result_found: Optional[bool] = None
    timestamp: Optional[Any] = None


class RecentViewed(BaseModel):
    model_config = _ID_COERCE_CONFIG
    id: str
    name: str
    cluster: Literal["recipe", "product"]
    viewed_at: Optional[Any] = None


# ── Recommendation item ───────────────────────────────────────────────────

class RecommendationItem(BaseModel):
    model_config = _ID_COERCE_CONFIG
    id: str
    name: str
    cluster: Literal["recipe", "product"]
    interaction_state: Optional[Literal["liked", "disliked"]] = None
    is_filler: bool = Field(
        False,
        description="True when this item fills an empty slot in the "
                    "'Previously Cooked' row (it is a recommendation, not a cooked item).",
    )
    # Recipe fields
    food_name:      Optional[str]   = None
    serving_size_g: Optional[float] = None
    calories:       Optional[float] = None
    protein:        Optional[float] = None
    carbohydrates:  Optional[float] = None
    fats:           Optional[float] = None
    fibre:          Optional[float] = None
    prep_time_mins: Optional[float] = None
    # Product fields
    brand:    Optional[str] = None
    category: Optional[str] = None
    # Cooked-row extras
    cooked_at: Optional[Any] = None
    rating:    Optional[int] = None


class RecommendationResponse(BaseModel):
    items:       List[RecommendationItem]
    cold_start:  bool = Field(False, description="True when falling back to popular items.")
    cluster:     str
    total:       int


# ── Profile ───────────────────────────────────────────────────────────────

class UserProfile(BaseModel):
    id:             str
    email:          Optional[str]
    name:           Optional[str]
    created_at:     Optional[Any] = None
    allergens:      List[str]     = Field(default_factory=list)
    total_searches: int           = 0
    total_cooked:   int           = 0
    total_liked:    int           = 0
    total_viewed:   int           = 0
    recent_searches: List[RecentSearch]  = Field(default_factory=list)
    recent_viewed:   List[RecentViewed]  = Field(default_factory=list)


# ── Cooked row item ───────────────────────────────────────────────────────

class CookedItem(BaseModel):
    model_config = _ID_COERCE_CONFIG
    id:             str
    name:           str
    food_name:      Optional[str]   = None
    serving_size_g: Optional[float] = None
    calories:       Optional[float] = None
    protein:        Optional[float] = None
    carbohydrates:  Optional[float] = None
    fats:           Optional[float] = None
    fibre:          Optional[float] = None
    prep_time_mins: Optional[float] = None
    cooked_at:      Optional[Any]   = None
    rating:         Optional[int]   = None
    cluster:        str             = "recipe"


class CookedResponse(BaseModel):
    items: List[CookedItem]
    total: int
