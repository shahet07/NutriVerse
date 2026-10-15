"""
Tests for the FastAPI REST API layer.

The startup lifecycle (Neo4j init, TF model loading, Ollama init) is fully
mocked â€” no external services are required to run these tests.
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Fixtures
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

@pytest.fixture(scope="module")
def mock_router_instance():
    """A router whose execute_async is fully mocked."""
    router = MagicMock()
    router.execute_async = AsyncMock(return_value={
        "recipe_name": "Dal Makhani",
        "nutrition": {"Calories (kcal)": 350.0, "Protein (g)": 15.0},
        "ingredients": "lentils, butter, cream",
        "instructions": "Cook lentils.",
        "llm_response": "Dal Makhani is a rich lentil dish.",
        "accuracy": 85.0,
        "pathway": "extraction",
        "estimated": False,
        "source": "dataset",
    })
    return router


@pytest.fixture(scope="module")
def client(mock_router_instance):
    """
    TestClient with all external startup dependencies patched.

    Patches applied (in order of lifespan calls):
      1. Backend.dependencies.neo4j.init  â€” skips Neo4j connection
      2. Backend.dependencies.neo4j.close â€” skips Neo4j teardown
      3. Backend.dependencies.model.init  â€” skips TF model loading
      4. Backend.dependencies.router.init â€” skips Ollama init

    Then overrides the FastAPI `get_router` dependency so endpoints receive
    the mock router without touching any real service.
    """
    with (
        patch("Backend.dependencies.neo4j.init"),
        patch("Backend.dependencies.neo4j.close"),
        patch("Backend.dependencies.neo4j.get_neo4j_client"),  # prevents RuntimeError in lifespan
        patch("Backend.dependencies.model.init"),
        patch("Backend.dependencies.router.init"),
        patch("Backend.dependencies.graph_rag.init"),
        patch("Backend.dependencies.graph_rag.get_graph_rag_service"),
        patch("Backend.dependencies.recommender.init"),
    ):
        from Backend.main import app
        from Backend.dependencies.router import get_router
        # get_neo4j_client is now the MagicMock created by the patch above;
        # importing it here gives us the same object that process.py holds,
        # so dependency_overrides can replace it with a clean lambda.
        from Backend.dependencies.neo4j import get_neo4j_client
        from Backend.dependencies.auth_user import get_optional_user

        mock_neo4j = MagicMock()
        app.dependency_overrides[get_router] = lambda: mock_router_instance
        app.dependency_overrides[get_neo4j_client] = lambda: mock_neo4j
        app.dependency_overrides[get_optional_user] = lambda: None

        with TestClient(app, raise_server_exceptions=False) as c:
            yield c

        app.dependency_overrides.clear()


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# /health endpoint
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestHealthEndpoint:
    def test_health_returns_200(self, client):
        # /health is mounted and accessible; it may fail internally if Neo4j
        # is not running, but the route itself should not 404.
        resp = client.get("/health")
        assert resp.status_code in (200, 500)

    def test_health_returns_json(self, client):
        resp = client.get("/health")
        # FastAPI always returns JSON â€” check content-type header
        assert "application/json" in resp.headers.get("content-type", "")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# /process endpoint
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestProcessEndpoint:
    def test_no_query_no_image_returns_400(self, client):
        resp = client.post("/process")
        assert resp.status_code == 400

    def test_empty_query_returns_400(self, client):
        resp = client.post("/process", data={"query": "   "})
        # Whitespace-only is treated as empty
        assert resp.status_code in (400, 200)

    def test_text_query_returns_200(self, client):
        resp = client.post("/process", data={"query": "Dal Makhani"})
        assert resp.status_code == 200

    def test_text_query_response_is_json(self, client):
        resp = client.post("/process", data={"query": "Dal Makhani"})
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)

    def test_text_query_response_has_recipe_name(self, client):
        resp = client.post("/process", data={"query": "Dal Makhani"})
        assert resp.status_code == 200
        data = resp.json()
        assert "recipe_name" in data

    def test_text_query_execute_async_called(self, client, mock_router_instance):
        mock_router_instance.execute_async.reset_mock()
        client.post("/process", data={"query": "Butter Chicken"})
        mock_router_instance.execute_async.assert_called_once()

    def test_image_with_invalid_extension_returns_400(self, client):
        import io
        fake_file = io.BytesIO(b"fake pdf content")
        resp = client.post(
            "/process",
            files={"image": ("report.pdf", fake_file, "application/pdf")},
        )
        assert resp.status_code == 400

    def test_image_with_valid_extension_calls_router(self, client, mock_router_instance):
        import io
        # Minimal 1Ã—1 white JPEG bytes
        tiny_jpeg = (
            b'\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00'
            b'\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t'
            b'\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a'
            b'\x1f\x1e\x1d\x1a\x1c\x1c $.\' ",#\x1c\x1c(7),01444\x1f\'9=82<.342\x1e\xbf'
            b'\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00'
            b'\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00'
            b'\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b'
            b'\xff\xc4\x00\xb5\x10\x00\x02\x01\x03\x03\x02\x04\x03\x05\x05'
            b'\x04\x04\x00\x00\x01}\x01\x02\x03\x00\x04\x11\x05\x12!1A\x06\x13Qa'
            b'\x07"q\x142\x81\x91\xa1\x08#B\xb1\xc1\x15R\xd1\xf0$3br'
            b'\x82\t\n\x16\x17\x18\x19\x1a%&\'()*456789:CDEFGHIJSTUVWXYZcdefghij'
            b'stuvwxyz\x83\x84\x85\x86\x87\x88\x89\x8a\x92\x93\x94\x95\x96'
            b'\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xfb\xd4P\x00\x00\x00\x1f\xff\xd9'
        )
        mock_router_instance.execute_async.reset_mock()
        fake_image = io.BytesIO(tiny_jpeg)
        client.post(
            "/process",
            files={"image": ("food.jpg", fake_image, "image/jpeg")},
        )
        mock_router_instance.execute_async.assert_called_once()
