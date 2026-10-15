"""
Tests for LLMEngine â€” structured nutrition estimation, modification,
comparison, and fallback estimation.

All tests use the mock_llm_client / mock_llm_engine fixtures from conftest
so no running Ollama instance is required.
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock
from pydantic import ValidationError

from Src.LLM.llm_engine import LLMEngine, NutritionEstimate


# NutritionEstimate Pydantic model

class TestNutritionEstimateModel:
    def test_valid_floats_accepted(self):
        n = NutritionEstimate(
            calories=350.0, protein=15.0, carbohydrates=45.0, fats=12.0, fiber=8.0
        )
        assert n.calories == 350.0
        assert n.fiber == 8.0

    def test_integer_values_coerced_to_float(self):
        n = NutritionEstimate(
            calories=300, protein=10, carbohydrates=40, fats=8, fiber=5
        )
        assert isinstance(n.calories, float)

    def test_string_numbers_coerced(self):
        n = NutritionEstimate(
            calories="200", protein="5", carbohydrates="30", fats="8", fiber="2"
        )
        assert n.calories == 200.0

    def test_missing_field_raises_validation_error(self):
        with pytest.raises(ValidationError):
            NutritionEstimate(calories=250.0, protein=8.0)  # missing 3 fields

    def test_non_numeric_string_raises_validation_error(self):
        with pytest.raises(ValidationError):
            NutritionEstimate(
                calories="two fifty", protein=8, carbohydrates=35, fats=10, fiber=3
            )

    def test_all_fields_present_in_model(self):
        n = NutritionEstimate(
            calories=100, protein=5, carbohydrates=20, fats=3, fiber=1
        )
        assert hasattr(n, "calories")
        assert hasattr(n, "protein")
        assert hasattr(n, "carbohydrates")
        assert hasattr(n, "fats")
        assert hasattr(n, "fiber")


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# estimate_single_dish_nutrition
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestEstimateSingleDishNutrition:
    def test_returns_dict_with_all_keys(self, mock_llm_engine):
        result = mock_llm_engine.estimate_single_dish_nutrition("Biryani")
        for key in ("Calories", "Protein", "Carbohydrates", "Fats", "Fiber"):
            assert key in result

    def test_calories_contains_kcal(self, mock_llm_engine):
        result = mock_llm_engine.estimate_single_dish_nutrition("Samosa")
        assert "kcal" in result["Calories"]

    def test_protein_value_contains_g(self, mock_llm_engine):
        result = mock_llm_engine.estimate_single_dish_nutrition("Idli")
        assert "g" in result["Protein"]

    def test_uses_generate_json_not_generate(self, mock_llm_client):
        """Verify the engine uses the structured JSON path, not plain text."""
        engine = LLMEngine(mock_llm_client)
        engine.estimate_single_dish_nutrition("Dosa")
        mock_llm_client.generate_json.assert_called_once()
        mock_llm_client.generate.assert_not_called()

    def test_json_exception_falls_back_to_defaults(self):
        bad_client = MagicMock()
        bad_client.generate_json.side_effect = Exception("JSON error")
        engine = LLMEngine(bad_client)
        result = engine.estimate_single_dish_nutrition("UnknownDish")
        # Must not crash and must return the fallback dict
        assert "Calories" in result
        assert "~" in result["Calories"]  # fallback values contain ~

    def test_invalid_json_structure_falls_back(self):
        """LLM returns JSON that doesn't match the schema â†’ fallback."""
        bad_client = MagicMock()
        bad_client.generate_json.return_value = {"wrong_key": 100}
        engine = LLMEngine(bad_client)
        result = engine.estimate_single_dish_nutrition("SomeDish")
        assert "Calories" in result
        assert "~" in result["Calories"]

    def test_partial_json_falls_back(self):
        """LLM returns only some keys â†’ ValidationError â†’ fallback."""
        partial_client = MagicMock()
        partial_client.generate_json.return_value = {"calories": 250}  # missing 4 fields
        engine = LLMEngine(partial_client)
        result = engine.estimate_single_dish_nutrition("SomeDish")
        assert "~" in result["Calories"]


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# modify_recipe
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestModifyRecipe:
    _NUTRITION = {"Calories (kcal)": 450, "Protein (g)": 30, "Fats (g)": 18}
    _INGREDIENTS = "chicken, butter, cream, tomato, spices"
    _METHOD = "Marinate chicken, cook in butter-cream sauce."

    def test_returns_modification_pathway(self, mock_llm_engine):
        result = mock_llm_engine.modify_recipe(
            "Butter Chicken", self._NUTRITION,
            self._INGREDIENTS, self._METHOD, "low fat"
        )
        assert result["pathway"] == "modification"

    def test_constraint_in_recipe_name(self, mock_llm_engine):
        result = mock_llm_engine.modify_recipe(
            "Butter Chicken", self._NUTRITION,
            self._INGREDIENTS, self._METHOD, "low fat"
        )
        assert "low fat" in result["recipe_name"].lower()

    def test_estimated_is_false(self, mock_llm_engine):
        result = mock_llm_engine.modify_recipe(
            "Butter Chicken", self._NUTRITION,
            self._INGREDIENTS, self._METHOD, "vegan"
        )
        assert result["estimated"] is False

    def test_source_is_dataset_plus_llm(self, mock_llm_engine):
        result = mock_llm_engine.modify_recipe(
            "Butter Chicken", self._NUTRITION,
            self._INGREDIENTS, self._METHOD, "keto"
        )
        assert result["source"] == "dataset + llm_modification"

    def test_constraint_stored_in_output(self, mock_llm_engine):
        constraint = "gluten free"
        result = mock_llm_engine.modify_recipe(
            "Naan", self._NUTRITION,
            self._INGREDIENTS, self._METHOD, constraint
        )
        assert result["constraint"] == constraint

    def test_original_nutrition_preserved(self, mock_llm_engine):
        result = mock_llm_engine.modify_recipe(
            "Butter Chicken", self._NUTRITION,
            self._INGREDIENTS, self._METHOD, "low oil"
        )
        assert result["nutrition"] == self._NUTRITION

    def test_llm_response_present(self, mock_llm_engine):
        result = mock_llm_engine.modify_recipe(
            "Butter Chicken", self._NUTRITION,
            self._INGREDIENTS, self._METHOD, "low fat"
        )
        assert "llm_response" in result
        assert result["llm_response"]


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# compare_dishes
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestCompareDishes:
    _NUT_A = {"Calories (kcal)": 350, "Protein (g)": 15, "Fats (g)": 12}
    _NUT_B = {"Calories (kcal)": 400, "Protein (g)": 30, "Fats (g)": 20}

    def test_pathway_is_comparison(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", self._NUT_A, "Butter Chicken", self._NUT_B
        )
        assert result["pathway"] == "comparison"

    def test_both_db_backed_accuracy_85(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", self._NUT_A, "Butter Chicken", self._NUT_B,
            is_a_estimated=False, is_b_estimated=False
        )
        assert result["accuracy"] == 85.0

    def test_both_estimated_accuracy_60(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "DishA", self._NUT_A, "DishB", self._NUT_B,
            is_a_estimated=True, is_b_estimated=True
        )
        assert result["accuracy"] == 60.0

    def test_both_estimated_flag_true(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "DishA", {}, "DishB", {},
            is_a_estimated=True, is_b_estimated=True
        )
        assert result["estimated"] is True

    def test_neither_estimated_flag_false(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", {}, "Butter Chicken", {},
            is_a_estimated=False, is_b_estimated=False
        )
        assert result["estimated"] is False

    def test_one_estimated_source_contains_mixed(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", {}, "UnknownDish", {},
            is_a_estimated=False, is_b_estimated=True
        )
        assert "estimated" in result["source"] or "mixed" in result["source"]

    def test_dish_names_preserved_in_output(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", self._NUT_A, "Butter Chicken", self._NUT_B
        )
        assert result["dish_a"] == "Dal Makhani"
        assert result["dish_b"] == "Butter Chicken"

    def test_nutrition_data_preserved(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", self._NUT_A, "Butter Chicken", self._NUT_B
        )
        assert result["nutrition_a"] == self._NUT_A
        assert result["nutrition_b"] == self._NUT_B

    def test_goal_stored_in_output(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", {}, "Butter Chicken", {}, user_goal="weight loss"
        )
        assert result["goal"] == "weight loss"

    def test_llm_response_present(self, mock_llm_engine):
        result = mock_llm_engine.compare_dishes(
            "Dal Makhani", self._NUT_A, "Butter Chicken", self._NUT_B
        )
        assert "llm_response" in result
        assert result["llm_response"]


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# estimate_nutrition (fallback estimator)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestEstimateNutrition:
    def test_estimated_flag_true(self, mock_llm_engine):
        result = mock_llm_engine.estimate_nutrition("Kachori")
        assert result["estimated"] is True

    def test_accuracy_is_50(self, mock_llm_engine):
        result = mock_llm_engine.estimate_nutrition("Kachori")
        assert result["accuracy"] == 50.0

    def test_source_is_llm_estimation(self, mock_llm_engine):
        result = mock_llm_engine.estimate_nutrition("Kachori")
        assert result["source"] == "llm_estimation"

    def test_pathway_is_estimation(self, mock_llm_engine):
        result = mock_llm_engine.estimate_nutrition("Kachori")
        assert result["pathway"] == "extraction"

    def test_recipe_name_contains_query(self, mock_llm_engine):
        result = mock_llm_engine.estimate_nutrition("Kachori")
        assert "Kachori" in result["recipe_name"]

    def test_llm_response_present(self, mock_llm_engine):
        result = mock_llm_engine.estimate_nutrition("Puri Bhaji")
        assert "llm_response" in result
        assert result["llm_response"]
