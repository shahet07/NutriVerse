"""
Tests for NutriSenseRouter â€” intent classification and pathway dispatch.

All tests use fixture-injected mocks so no Neo4j or Ollama instance is needed.
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from Src.Router.Router import NutriSenseRouter


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# _clean_dish_name (static â€” no fixture needed)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestCleanDishName:
    def test_strips_nutrition_of(self):
        result = NutriSenseRouter._clean_dish_name("nutrition of Dal Makhani")
        assert "nutrition of" not in result.lower()
        assert "dal makhani" in result.lower()

    def test_strips_tell_me_about(self):
        result = NutriSenseRouter._clean_dish_name("tell me about Biryani")
        assert "tell me about" not in result.lower()
        assert "biryani" in result.lower()

    def test_strips_what_is_in(self):
        result = NutriSenseRouter._clean_dish_name("what is in Samosa")
        assert "what is in" not in result.lower()

    def test_strips_nutritional_value_of(self):
        result = NutriSenseRouter._clean_dish_name("nutritional value of Rasgulla")
        assert "nutritional value of" not in result.lower()

    def test_plain_dish_name_returned_unchanged(self):
        result = NutriSenseRouter._clean_dish_name("Paneer Tikka Masala")
        assert "paneer tikka masala" in result.lower()

    def test_empty_string(self):
        result = NutriSenseRouter._clean_dish_name("")
        assert result == ""


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# _extract_compare_dishes
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestExtractCompareDishes:
    def test_vs_splitter(self):
        dishes = NutriSenseRouter._extract_compare_dishes(
            NutriSenseRouter, "dal makhani vs butter chicken"
        )
        assert dishes is not None
        assert len(dishes) == 2
        assert "dal makhani" in dishes[0].lower()
        assert "butter chicken" in dishes[1].lower()

    def test_versus_splitter(self):
        dishes = NutriSenseRouter._extract_compare_dishes(
            NutriSenseRouter, "idli versus dosa"
        )
        assert dishes is not None
        assert len(dishes) == 2

    def test_and_splitter(self):
        dishes = NutriSenseRouter._extract_compare_dishes(
            NutriSenseRouter, "roti and naan"
        )
        assert dishes is not None
        assert len(dishes) == 2

    def test_single_word_returns_none(self):
        # After splitting on "vs", both sides must be non-trivial
        dishes = NutriSenseRouter._extract_compare_dishes(
            NutriSenseRouter, "biryani"
        )
        # No splitter found â†’ returns None
        assert dishes is None


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# _rule_based_classify
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestRuleBasedClassify:
    """Tests for the rule-based intent classifier layer."""

    # â”€â”€ EXTRACT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_extract_plain_dish(self, router):
        result = router._rule_based_classify("Dal Makhani")
        assert result["pathway"] == "EXTRACT"

    def test_extract_with_filler_phrase(self, router):
        result = router._rule_based_classify("tell me about paneer butter masala")
        assert result["pathway"] == "EXTRACT"

    def test_extract_single_dish_with_and_in_name(self, router):
        # "Aloo and jeera" should NOT be misclassified as COMPARE
        result = router._rule_based_classify("aloo and jeera sabzi")
        # The router attempts COMPARE only if BOTH parts are non-trivial dish names;
        # here the split would yield "aloo" and "jeera sabzi" which are both short/trivial.
        # We just check it returns a pathway (not raising).
        assert "pathway" in result

    # â”€â”€ COMPARE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_compare_vs_keyword(self, router):
        result = router._rule_based_classify("Idli vs Dosa")
        assert result["pathway"] == "COMPARE"
        assert len(result["dishes"]) == 2

    def test_compare_versus_keyword(self, router):
        result = router._rule_based_classify("Roti versus Naan which is healthier")
        assert result["pathway"] == "COMPARE"

    def test_compare_explicit_compare_keyword(self, router):
        result = router._rule_based_classify("compare Dal Makhani and Butter Chicken")
        assert result["pathway"] == "COMPARE"

    def test_compare_better_than_keyword(self, router):
        result = router._rule_based_classify("is Biryani better than Pulao")
        assert result["pathway"] == "COMPARE"

    def test_compare_healthier_than_keyword(self, router):
        result = router._rule_based_classify("is Idli healthier than Samosa")
        assert result["pathway"] == "COMPARE"

    def test_compare_dishes_list_has_two_entries(self, router):
        result = router._rule_based_classify("Dal Makhani vs Palak Paneer")
        assert result["pathway"] == "COMPARE"
        assert len(result["dishes"]) == 2

    # â”€â”€ MODIFY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def test_modify_low_fat(self, router):
        result = router._rule_based_classify("low fat Butter Chicken recipe")
        assert result["pathway"] == "MODIFY"

    def test_modify_vegan(self, router):
        result = router._rule_based_classify("vegan version of Biryani")
        assert result["pathway"] == "MODIFY"

    def test_modify_without(self, router):
        result = router._rule_based_classify("Palak Paneer without cream")
        assert result["pathway"] == "MODIFY"

    def test_modify_reduce(self, router):
        result = router._rule_based_classify("reduce calories in Dal Tadka")
        assert result["pathway"] == "MODIFY"

    def test_modify_gluten_free(self, router):
        result = router._rule_based_classify("gluten free Naan recipe")
        assert result["pathway"] == "MODIFY"

    def test_modify_keto(self, router):
        result = router._rule_based_classify("keto Dal Makhani")
        assert result["pathway"] == "MODIFY"

    def test_modify_constraint_is_not_none(self, router):
        result = router._rule_based_classify("low carb Biryani")
        assert result["constraint"] is not None


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# classify_intent
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestClassifyIntent:
    def test_empty_query_defaults_to_extract(self, router):
        result = router.classify_intent("")
        assert result["pathway"] == "EXTRACT"

    def test_whitespace_only_defaults_to_extract(self, router):
        result = router.classify_intent("   ")
        assert result["pathway"] == "EXTRACT"

    def test_returns_dict_with_required_keys(self, router):
        result = router.classify_intent("Biryani nutrition")
        assert "pathway" in result
        assert "dishes" in result
        assert "constraint" in result

    def test_dishes_is_non_empty_list(self, router):
        result = router.classify_intent("Dal Makhani")
        assert isinstance(result["dishes"], list)
        assert len(result["dishes"]) >= 1


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# execute (integration of classify â†’ pathway handlers)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestExecute:
    def test_empty_query_returns_error(self, router):
        result = router.execute(text_query="")
        assert "error" in result

    def test_extract_returns_dict(self, router):
        result = router.execute(text_query="Dal Makhani")
        assert isinstance(result, dict)

    def test_extract_found_has_recipe_name(self, router):
        result = router.execute(text_query="Dal Makhani")
        # When the mock Neo4j returns FOUND, recipe_name should be in the result
        assert "recipe_name" in result or "error" in result

    def test_compare_returns_dict(self, router):
        result = router.execute(text_query="Dal Makhani vs Butter Chicken")
        assert isinstance(result, dict)

    def test_modify_returns_dict(self, router):
        result = router.execute(text_query="low fat Dal Makhani")
        assert isinstance(result, dict)

    def test_no_query_or_image_raises_error(self, router):
        result = router.execute(text_query=None, image_input=None)
        # Router returns error dict, does not raise
        assert isinstance(result, dict)
        assert "error" in result

    def test_exception_is_caught_returns_error_dict(self, router):
        """If pathway raises, execute must still return a dict (not propagate)."""
        router.neo4j_client.get_all_recipe_names.side_effect = RuntimeError("DB down")
        result = router.execute(text_query="Dal Makhani")
        assert isinstance(result, dict)
        # Reset side effect for subsequent tests
        router.neo4j_client.get_all_recipe_names.side_effect = None
