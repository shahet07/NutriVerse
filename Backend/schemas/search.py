"""Search response schemas (Phase 3 — GraphRAG)."""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class SearchResult(BaseModel):
    id: str
    name: str
    cluster: Literal["recipe", "product"]
    interaction_state: Optional[Literal["liked", "disliked"]] = None
    vector_score: float = Field(0.0, description="Cosine similarity [0, 1]")
    graph_score:  float = Field(0.0, description="HealthTag match ratio [0, 1]")
    final_score:  float = Field(0.0, description="Weighted combined score")
    # Optional extras — present for Recipe results
    food_name:      Optional[str] = None
    serving_size_g: Optional[float] = None
    prep_time_mins: Optional[float] = None
    calories:       Optional[float] = None
    protein:        Optional[float] = None
    carbohydrates:  Optional[float] = None
    fats:           Optional[float] = None
    fibre:          Optional[float] = None
    free_sugar:     Optional[float] = None
    sodium:         Optional[float] = None
    calcium:        Optional[float] = None
    iron:           Optional[float] = None
    vitamin_c:      Optional[float] = None
    folate:         Optional[float] = None
    raw_ingredients: Optional[str] = None
    instructions:   Optional[str] = None
    # Optional extras — present for FoodProduct results
    brand:              Optional[str] = None
    category:           Optional[str] = None
    nutriscore_grade:   Optional[str] = None
    nova_group:         Optional[float] = None
    calories_100g:      Optional[float] = None
    proteins_100g:      Optional[float] = None
    carbohydrates_100g: Optional[float] = None
    fat_100g:           Optional[float] = None
    fiber_100g:         Optional[float] = None
    sodium_100g:        Optional[float] = None
    sugars_100g:        Optional[float] = None
    image_url:          Optional[str] = None
    # Catch-all for any other fields returned by the DB
    extra: Optional[Dict[str, Any]] = Field(None, exclude=True)

    model_config = ConfigDict(extra="allow", coerce_numbers_to_str=True)


class SearchResponse(BaseModel):
    query:          str
    cluster_filter: str = Field(..., description="'all' | 'recipe' | 'product'")
    health_tags:    List[str] = Field(default_factory=list)
    excluded_allergens: List[str] = Field(default_factory=list)
    total:          int
    results:        List[SearchResult]
    vector_search_used: bool = Field(
        True, description="False when falling back to full-text search"
    )
    health_tags_available: List[str] = Field(default_factory=list)
