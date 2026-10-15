"""
Shared pytest fixtures for NutriSense-AI tests.

Fixtures provided:
  mock_llm_client   â€” MagicMock(spec=OllamaLLMClient) with sensible defaults
  mock_llm_engine   â€” real LLMEngine wired to mock_llm_client
  mock_neo4j        â€” MagicMock Neo4j client with a small in-memory recipe set
  router            â€” NutriSenseRouter(neo4j=mock_neo4j, engine=mock_llm_engine)
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock

from Src.LLM.llm_client import OllamaLLMClient
from Src.LLM.llm_engine import LLMEngine
from Src.Router.Router import NutriSenseRouter


# â”€â”€ LLM Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@pytest.fixture
def mock_llm_client():
    client = MagicMock(spec=OllamaLLMClient)
    client.generate.return_value = "This is a mock LLM text response."
    # generate_json returns a valid NutritionEstimate-compatible dict
    client.generate_json.return_value = {
        "calories": 250.0,
        "protein": 8.0,
        "carbohydrates": 35.0,
        "fats": 10.0,
        "fiber": 3.0,
    }
    client.generate_async = AsyncMock(return_value="Mock async text response.")
    client.generate_json_async = AsyncMock(return_value={
        "calories": 250.0,
        "protein": 8.0,
        "carbohydrates": 35.0,
        "fats": 10.0,
        "fiber": 3.0,
    })
    return client


# â”€â”€ LLM Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@pytest.fixture
def mock_llm_engine(mock_llm_client):
    """Real LLMEngine backed by a mocked HTTP client â€” no Ollama required."""
    return LLMEngine(mock_llm_client)


# â”€â”€ Neo4j Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

_SAMPLE_RECIPE = {
    "id": 1,
    "name": "Dal Makhani",
    "food_name": "dal makhani",
    "serving_size_g": 250.0,
    "prep_time_mins": 45,
    "instructions": "Cook lentils with butter and cream.",
    "raw_ingredients": "lentils, butter, cream, spices",
    "calories": 350.0,
    "carbohydrates": 45.0,
    "protein": 15.0,
    "fats": 12.0,
    "free_sugar": 2.0,
    "fibre": 8.0,
    "sodium": 400.0,
    "calcium": 80.0,
    "iron": 3.5,
    "vitamin_c": 5.0,
    "folate": 50.0,
}

_ALL_RECIPE_NAMES = [
    {"name": "Dal Makhani",     "food_name": "dal makhani"},
    {"name": "Butter Chicken",  "food_name": "butter chicken"},
    {"name": "Biryani",         "food_name": "biryani"},
    {"name": "Palak Paneer",    "food_name": "palak paneer"},
    {"name": "Idli",            "food_name": "idli"},
    {"name": "Dosa",            "food_name": "dosa"},
]


@pytest.fixture
def mock_neo4j():
    client = MagicMock()
    client.get_all_recipe_names.return_value = _ALL_RECIPE_NAMES
    client.get_recipe_by_name.return_value = _SAMPLE_RECIPE
    return client


# â”€â”€ Router â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@pytest.fixture
def router(mock_neo4j, mock_llm_engine):
    return NutriSenseRouter(
        neo4j_client=mock_neo4j,
        llm_engine=mock_llm_engine,
        image_model=None,
    )
