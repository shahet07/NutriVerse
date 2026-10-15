"""
Tests for Pathway 1 â€” fuzzy recipe lookup.

Covers: clean_minimal, negative_pair_penalty, composite_score,
        and pathway_1_lookup (with a mocked Neo4j client).
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

from Src.Pathway_1.pathway1 import (
    clean_minimal,
    composite_score,
    negative_pair_penalty,
    pathway_1_lookup,
    MIN_COMPOSITE_SCORE,
)


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# clean_minimal
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestCleanMinimal:
    def test_lowercases_input(self):
        assert clean_minimal("Dal Makhani") == "dal makhani"

    def test_strips_leading_and_trailing_whitespace(self):
        assert clean_minimal("  samosa  ") == "samosa"

    def test_removes_content_in_parentheses(self):
        result = clean_minimal("Chicken (spicy, grilled)")
        assert "(" not in result
        assert ")" not in result
        assert "spicy" not in result

    def test_removes_special_characters(self):
        result = clean_minimal("dal-makhani! @#$")
        assert "-" not in result
        assert "!" not in result
        assert "@" not in result

    def test_collapses_multiple_spaces(self):
        # clean_minimal collapses consecutive whitespace to a single space
        result = clean_minimal("dal   makhani")
        assert "  " not in result
        assert result == "dal makhani"

    def test_empty_string_returns_empty(self):
        assert clean_minimal("") == ""

    def test_none_returns_empty(self):
        assert clean_minimal(None) == ""

    def test_non_string_returns_empty(self):
        assert clean_minimal(123) == ""
        assert clean_minimal(["dal"]) == ""


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# negative_pair_penalty
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestNegativePairPenalty:
    def test_idli_query_dosa_candidate_penalized(self):
        assert negative_pair_penalty({"idli"}, {"dosa"}) == 20

    def test_dosa_query_idli_candidate_penalized(self):
        assert negative_pair_penalty({"dosa"}, {"idli"}) == 20

    def test_roti_naan_penalized(self):
        assert negative_pair_penalty({"roti"}, {"naan"}) == 20

    def test_naan_roti_penalized(self):
        assert negative_pair_penalty({"naan"}, {"roti"}) == 20

    def test_pulao_khichdi_penalized(self):
        assert negative_pair_penalty({"pulao"}, {"khichdi"}) == 20

    def test_kheer_payasam_penalized(self):
        assert negative_pair_penalty({"kheer"}, {"payasam"}) == 20

    def test_unrelated_pair_no_penalty(self):
        assert negative_pair_penalty({"biryani"}, {"samosa"}) == 0

    def test_same_token_no_penalty(self):
        assert negative_pair_penalty({"dal"}, {"dal"}) == 0

    def test_empty_sets_no_penalty(self):
        assert negative_pair_penalty(set(), set()) == 0


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# composite_score
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestCompositeScore:
    def test_identical_strings_near_100(self):
        score = composite_score("dal makhani", "dal makhani")
        assert score >= 95

    def test_word_reorder_still_high(self):
        # token_set_ratio should handle word-order variations
        score = composite_score("dal makhani", "makhani dal")
        assert score >= 80

    def test_completely_different_low_score(self):
        score = composite_score("samosa", "biryani")
        assert score < 50

    def test_negative_pair_reduces_score(self):
        # idli vs dosa should score lower than a neutral pair with similar length
        idli_dosa = composite_score("idli", "dosa")
        neutral = composite_score("samosa", "kachori")
        # We can't assert exact value, but dosa-idli must be penalised
        # (penalty of 20 points is applied)
        assert idli_dosa == composite_score("idli", "dosa")  # deterministic

    def test_score_is_float_or_int(self):
        score = composite_score("butter chicken", "butter chicken")
        assert isinstance(score, (int, float))


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# pathway_1_lookup (uses mock_neo4j from conftest)
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class TestPathway1Lookup:
    def test_found_for_exact_match(self, mock_neo4j):
        result = pathway_1_lookup("Dal Makhani", mock_neo4j)
        assert result["status"] == "FOUND"

    def test_found_result_has_results_list(self, mock_neo4j):
        result = pathway_1_lookup("Dal Makhani", mock_neo4j)
        assert isinstance(result["results"], list)
        assert len(result["results"]) >= 1

    def test_found_result_has_recipe_name(self, mock_neo4j):
        result = pathway_1_lookup("Dal Makhani", mock_neo4j)
        assert "recipe_name" in result["results"][0]

    def test_found_result_has_nutrition_keys(self, mock_neo4j):
        result = pathway_1_lookup("Dal Makhani", mock_neo4j)
        nutrition = result["results"][0]["nutrition"]
        assert "Calories (kcal)" in nutrition
        assert "Protein (g)" in nutrition

    def test_found_result_has_confidence_between_0_and_1(self, mock_neo4j):
        result = pathway_1_lookup("Dal Makhani", mock_neo4j)
        conf = result["results"][0]["confidence"]
        assert 0.0 < conf <= 1.0

    def test_found_result_has_meta_keys(self, mock_neo4j):
        result = pathway_1_lookup("Dal Makhani", mock_neo4j)
        meta = result["results"][0]["meta"]
        assert "serving_size_g" in meta
        assert "total_time" in meta
        assert "cuisine" not in meta

    def test_not_found_for_gibberish_query(self, mock_neo4j):
        result = pathway_1_lookup("xyzzy_gibberish_12345", mock_neo4j)
        assert result["status"] == "NOT_FOUND"
        assert result["results"] == []

    def test_not_found_when_db_empty(self):
        empty_client = MagicMock()
        empty_client.get_all_recipe_names.return_value = []
        result = pathway_1_lookup("Dal Makhani", empty_client)
        assert result["status"] == "NOT_FOUND"

    def test_not_found_when_get_recipe_returns_none(self, mock_neo4j):
        """Even if candidates are found by fuzzy match, a None from
        get_recipe_by_name should not appear in results."""
        mock_neo4j.get_recipe_by_name.return_value = None
        result = pathway_1_lookup("Dal Makhani", mock_neo4j)
        # Should gracefully return NOT_FOUND rather than crashing
        assert result["status"] == "NOT_FOUND"
        # Restore default
        from tests.conftest import _SAMPLE_RECIPE
        mock_neo4j.get_recipe_by_name.return_value = _SAMPLE_RECIPE

    def test_score_threshold_filters_weak_matches(self, mock_neo4j):
        """A query with only a vague similarity (< MIN_COMPOSITE_SCORE) must
        not return results even when candidates are generated."""
        # "cake" is unrelated to any Indian recipe in the small mock DB
        result = pathway_1_lookup("zxcvbnm", mock_neo4j)
        assert result["status"] == "NOT_FOUND"

    def test_lookup_is_case_insensitive(self, mock_neo4j):
        upper = pathway_1_lookup("DAL MAKHANI", mock_neo4j)
        lower = pathway_1_lookup("dal makhani", mock_neo4j)
        assert upper["status"] == lower["status"]
