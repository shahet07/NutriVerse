"""Regression tests for bugs found while getting the app running locally."""
from __future__ import annotations

import pytest

from Backend.dependencies.session_id import is_valid_session_id


@pytest.mark.parametrize("query", ["yellow dal", "boneless chicken", "dal and rice", "piano cake"])
def test_substrings_do_not_trigger_other_pathways(router, query):
    assert router._rule_based_classify(query)["pathway"] == "EXTRACT"


def test_calorie_question_is_a_lookup_of_the_dish(router):
    result = router._rule_based_classify("how many calories in dosa")
    assert result["pathway"] == "EXTRACT"
    assert result["dishes"] == ["dosa"]


@pytest.mark.parametrize("query", ["high protein breakfast", "keto snacks", "suggest low fat snacks"])
def test_category_queries_route_to_search(router, query):
    assert router._rule_based_classify(query)["pathway"] == "SEARCH"


def test_negated_ingredient_list_is_a_modification(router):
    assert router._rule_based_classify("dal without onion and garlic")["pathway"] == "MODIFY"


def test_question_word_can_is_not_a_product_signal(router):
    assert router._detect_cluster("can i eat dosa") == "recipe"
    assert router._detect_cluster("mother dairy lassi") == "product"


@pytest.mark.parametrize("session_id,valid", [
    ("chef-0123456789abcdef", True),
    ("k-0123456789abcdef", True),
    ("short", False),
    ("../../etc/passwd", False),
])
def test_session_id_validation(session_id, valid):
    assert is_valid_session_id(session_id) is valid


def test_revoked_tokens_survive_a_restart(tmp_path, monkeypatch):
    import importlib

    import Backend.dependencies.jti_blacklist as jti

    monkeypatch.setenv("REPORT_DIR", str(tmp_path))
    try:
        importlib.reload(jti)
        jti.revoke("token-1")
        assert jti.is_revoked("token-1")
        importlib.reload(jti)  # simulates a server restart
        assert jti.is_revoked("token-1")
    finally:
        monkeypatch.delenv("REPORT_DIR")
        importlib.reload(jti)


def test_webm_chunks_reach_the_audio_buffer():
    import inspect

    from Backend.api import voice_stream

    source = inspect.getsource(voice_stream.chef_voice_websocket)
    code_lines = [line.split("#")[0] for line in source.splitlines()]
    assert any("audio_buffer.extend(chunk)" in line for line in code_lines)


class TestDevLogin:
    @pytest.fixture
    def call(self, monkeypatch):
        import asyncio
        from unittest.mock import MagicMock

        from fastapi import HTTPException

        from Backend.api import auth
        from Backend.schemas.auth import DevLoginRequest

        monkeypatch.setattr(auth.settings, "auth_secret_key", "test-secret-key-for-unit-tests-only")

        def _call(enabled, host):
            monkeypatch.setattr(auth.settings, "auth_dev_login", enabled)
            request = MagicMock()
            request.client.host = host
            try:
                coro = auth.dev_login(DevLoginRequest(email="a@b.co"), request, MagicMock())
                return asyncio.run(coro)
            except HTTPException as exc:
                return exc.status_code

        return _call

    def test_disabled_by_default(self, call):
        assert call(False, "127.0.0.1") == 404

    def test_rejects_non_loopback_even_when_enabled(self, call):
        assert call(True, "203.0.113.9") == 404

    def test_issues_tokens_for_loopback_when_enabled(self, call):
        assert call(True, "127.0.0.1").access_token


def test_spa_fallback_cannot_read_outside_build_dir(tmp_path):
    """Same containment check as Backend/main.py's spa_fallback."""
    import os

    root = os.path.realpath(tmp_path / "dist")
    os.makedirs(root)
    candidate = os.path.realpath(os.path.join(root, "../secret.txt"))
    assert not candidate.startswith(root + os.sep)


def test_missing_model_disables_photos_without_crashing(tmp_path, monkeypatch):
    from Backend.dependencies import model

    pointer = tmp_path / "model.pth"
    pointer.write_text("version https://git-lfs.github.com/spec/v1\n")
    monkeypatch.setattr(model, "MODEL_PATH", str(pointer))
    monkeypatch.setattr(model, "_wrapper", None)
    model.init()
    assert model.get_image_model() is None


def test_photo_request_without_model_returns_503(router):
    import asyncio

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        asyncio.run(router.execute_async(image_input="photo.jpg"))
    assert exc.value.status_code == 503


@pytest.mark.parametrize("query", [
    "who much calories should be in 1 bowl of chicken biryani ?",
    "how many calories in 1 bowl of chicken biryani",
    "how much protein is in chicken biryani?",
    "a plate of chicken biryani",
])
def test_question_wording_is_stripped_from_the_dish_name(router, query):
    assert router._rule_based_classify(query)["dishes"] == ["chicken biryani"]


def test_text_is_answered_when_photo_model_is_missing(router):
    import asyncio

    result = asyncio.run(router.execute_async(text_query="Dal Makhani", image_input="photo.jpg"))
    assert "recipe_name" in result


@pytest.mark.parametrize("text,names_dish", [
    ("how many calories in 1 bowl of chicken biryani?", True),
    ("how many calories in this?", False),
    ("what is this dish", False),
    ("", False),
    (None, False),
])
def test_text_vs_photo_decision(router, text, names_dish):
    assert router._text_names_dish(text) is names_dish


class TestFollowUpDishSwitch:
    BIRYANI = {"recipe_name": "chicken biryani (Estimated)", "ingredients": "rice, chicken, onion"}

    @pytest.fixture
    def vocab_router(self, router):
        router.neo4j_client.get_all_recipe_names.return_value = [
            {"name": "Masala Dosa", "food_name": "masala dosa"},
            {"name": "Neer Dosa", "food_name": "neer dosa"},
            {"name": "Mutton Biryani", "food_name": "mutton biryani/biriyani"},
            {"name": "Chicken Curry", "food_name": "chicken curry"},
            {"name": "Idli", "food_name": "idli"},
        ]
        return router

    @pytest.mark.parametrize("message,dish", [
        ("okay can you tell me in one dosa?", "dosa"),
        ("tell me how much calories are there in the 1 dosa", "dosa"),
        ("what about masala dosa", "masala dosa"),
        ("and 2 idlis?", "idli"),
    ])
    def test_switches_to_a_different_dish(self, vocab_router, message, dish):
        assert vocab_router.find_new_dish(message, self.BIRYANI) == dish

    @pytest.mark.parametrize("message", [
        "can I use less rice?",
        "is it spicy?",
        "is it rich in protein?",
        "is this home made or plain",
        "how much protein does it have",
        "can I replace chicken with idli",
    ])
    def test_stays_on_the_current_dish(self, vocab_router, message):
        assert vocab_router.find_new_dish(message, self.BIRYANI) is None

    def test_same_dish_is_not_a_switch(self, vocab_router):
        assert vocab_router.find_new_dish("more about dosa", {"recipe_name": "Masala Dosa"}) is None

    def test_keeps_ingredient_qualifier(self, vocab_router):
        assert vocab_router.find_new_dish("now chicken biryani", {"recipe_name": "Idli"}) == "chicken biryani"
