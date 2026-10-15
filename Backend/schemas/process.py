from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel


class ExtractionResponse(BaseModel):
    pathway: str = "extraction"
    status: Optional[str] = None
    recipe_name: Optional[str] = None
    confidence: Optional[float] = None
    nutrition: Optional[Dict[str, Any]] = None
    ingredients: Optional[str] = None
    instructions: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None
    variants: Optional[List[Dict[str, Any]]] = None
    llm_response: Optional[str] = None
    accuracy: Optional[float] = None
    source: Optional[str] = None
    estimated: Optional[bool] = None


class ComparisonResponse(BaseModel):
    pathway: str = "comparison"
    dish_a: Optional[str] = None
    nutrition_a: Optional[Dict[str, Any]] = None
    dish_b: Optional[str] = None
    nutrition_b: Optional[Dict[str, Any]] = None
    llm_response: Optional[str] = None
    goal: Optional[str] = None
    estimated: Optional[bool] = None
    accuracy: Optional[float] = None
    source: Optional[str] = None


class ModificationResponse(BaseModel):
    pathway: str = "modification"
    recipe_name: Optional[str] = None
    constraint: Optional[str] = None
    nutrition: Optional[Dict[str, Any]] = None
    ingredients: Optional[str] = None
    instructions: Optional[str] = None
    llm_response: Optional[str] = None
    accuracy: Optional[float] = None
    source: Optional[str] = None
    estimated: Optional[bool] = None


class RouterSearchResponse(BaseModel):
    pathway: str = "search"
    query: str
    results: List[Dict[str, Any]]
    total: int
    llm_response: Optional[str] = None


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None


ProcessResponse = Union[
    ExtractionResponse,
    ComparisonResponse,
    ModificationResponse,
    RouterSearchResponse,
    ErrorResponse,
]
