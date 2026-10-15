from __future__ import annotations

from pydantic import BaseModel, Field, ValidationError


class NutritionEstimate(BaseModel):
    """Structured schema for a single-dish nutrition estimate.

    Pydantic validates and coerces the values returned by the LLM in JSON
    mode, eliminating per-line string splitting and hardcoded fallback
    parsing entirely.
    """

    calories: float = Field(..., description="Total calories in kcal")
    protein: float = Field(..., description="Protein in grams")
    carbohydrates: float = Field(..., description="Carbohydrates in grams")
    fats: float = Field(..., description="Fats in grams")
    fiber: float = Field(..., description="Dietary fiber in grams")


class LLMEngine:
    """
    LLM reasoning engine for NutriSense AI.
    Now returns structured data that the frontend can render beautifully.
    """

    def __init__(self, llm_client):
        self.llm = llm_client

    _NUTRITION_FALLBACK = {
        "Calories": "~250 kcal",
        "Protein": "~8g",
        "Carbohydrates": "~35g",
        "Fats": "~10g",
        "Fiber": "~3g",
    }

    def estimate_single_dish_nutrition(self, dish_name: str) -> dict:
        """
        Estimate nutrition for a single dish when not in database.

        Uses Ollama's JSON mode so the model is *forced* to emit a valid JSON
        object.  The result is validated with the ``NutritionEstimate`` Pydantic
        model — no fragile line-splitting required.

        Returns a nutrition dict compatible with comparison and the frontend.
        Falls back to approximate placeholder values if validation fails.
        """
        prompt = f"""You are a nutrition expert. Estimate nutrition for this Indian dish.

DISH: {dish_name}

Return a JSON object with EXACTLY these keys for one typical serving.
All values must be plain numbers (no units, no strings):

{{
  "calories": <number>,
  "protein": <number>,
  "carbohydrates": <number>,
  "fats": <number>,
  "fiber": <number>
}}

Base estimates on typical Indian recipes and a standard single-portion serving size."""

        try:
            data = self.llm.generate_json(prompt)
            model = NutritionEstimate(**data)
            return {
                "Calories": f"{model.calories} kcal",
                "Protein": f"{model.protein}g",
                "Carbohydrates": f"{model.carbohydrates}g",
                "Fats": f"{model.fats}g",
                "Fiber": f"{model.fiber}g",
            }
        except (ValidationError, KeyError, Exception):
            return dict(self._NUTRITION_FALLBACK)

    def modify_recipe(
        self,
        dish_name: str,
        nutrition: dict,
        ingredients: str,
        method: str,
        user_constraint: str
    ) -> dict:
        """
        Modify an existing recipe while preserving dish identity.
        Returns structured data for frontend.
        """

        prompt = f"""You are a nutrition expert. Modify this recipe based on the user's request.

ORIGINAL RECIPE:
Dish: {dish_name}

Nutrition (per serving):
{self._format_nutrition(nutrition)}

Ingredients:
{ingredients}

Cooking Method:
{method}

USER REQUEST:
{user_constraint}

TASK:
1. Suggest ingredient substitutions to meet the constraint
2. Modify the cooking method if needed
3. Explain how this affects nutrition (qualitatively - do NOT invent exact numbers)
4. Keep the dish recognizable

FORMAT YOUR RESPONSE CLEARLY WITH SECTIONS:
**Modified Ingredients:**
[List changes here]

**Modified Cooking Method:**
[Describe changes here]

**Nutritional Impact:**
[Explain how nutrition changes - use terms like "reduced", "lower", "higher" - NO exact numbers]

**Tips:**
[Any additional advice]
"""

        response = self.llm.generate(prompt)

        return {
            "recipe_name": f"{dish_name} ({user_constraint})",
            "nutrition": nutrition,  # Keep original for reference
            "ingredients": "See modified version below",
            "instructions": "See modified version below",
            "llm_response": response,
            "pathway": "modification",
            "constraint": user_constraint,
            "estimated": False,
            "source": "dataset + llm_modification"
        }

    def compare_dishes(
        self,
        dish_a: str,
        nutrition_a: dict,
        dish_b: str,
        nutrition_b: dict,
        user_goal: str | None = None,
        is_a_estimated: bool = False,
        is_b_estimated: bool = False
    ) -> dict:
        """
        Compare two dishes using dataset-backed nutrition OR estimates.
        Returns structured comparison for frontend.
        """
        
        estimation_note = ""
        if is_a_estimated and is_b_estimated:
            estimation_note = "⚠ Both sets of values are estimates — actual nutrition may vary by recipe or brand."
        elif is_a_estimated:
            estimation_note = f"⚠ {dish_a} values are estimated — actual nutrition may vary."
        elif is_b_estimated:
            estimation_note = f"⚠ {dish_b} values are estimated — actual nutrition may vary."

        goal_label = user_goal if user_goal else "general healthy eating"

        prompt = f"""You are NutriVerse, a nutrition intelligence assistant. Compare two foods using ONLY the data provided below. Never invent numbers.

FOOD A — {dish_a}
{self._format_nutrition(nutrition_a)}

FOOD B — {dish_b}
{self._format_nutrition(nutrition_b)}

HEALTH GOAL: {goal_label}
{estimation_note}

Write a focused, decisive comparison. Cite the actual values from the data. Be specific — users are making a food choice right now.

Use exactly these sections:

**Quick Verdict**
One sentence naming the better choice for {goal_label} and the single strongest reason.

**Nutritional Breakdown**
Compare each nutrient directly using the numbers above:
- Calories: [A value] vs [B value] — [which is lower/higher and what it means]
- Protein: [A value] vs [B value] — [satiety/muscle impact]
- Carbohydrates: [A value] vs [B value] — [energy/blood sugar impact]
- Fats: [A value] vs [B value] — [note if saturated fat data is available]
- Fibre: [A value] vs [B value] — [digestion/satiety impact]

**What This Means For You**
2–3 sentences: practical context for someone with the goal of {goal_label}. When should they pick A? When should they pick B?

**Bottom Line**
Choose **{dish_a}** if [specific condition].
Choose **{dish_b}** if [specific condition].
"""

        response = self.llm.generate(prompt)

        return {
            "dish_a": dish_a,
            "nutrition_a": nutrition_a,
            "dish_b": dish_b,
            "nutrition_b": nutrition_b,
            "llm_response": response,
            "pathway": "comparison",
            "goal": user_goal,
            "estimated": is_a_estimated or is_b_estimated,
            "accuracy": 85.0 if not (is_a_estimated or is_b_estimated) else 60.0,
            "source": "dataset + llm_comparison" if not (is_a_estimated or is_b_estimated) else "mixed/estimated + llm_comparison"
        }

    def estimate_nutrition(self, user_query: str) -> dict:
        """
        Estimate nutrition when dataset lookup fails.
        Returns structured estimates with clear disclaimers.
        """

        prompt = f"""You are a nutrition expert. The user asked about a dish not in our database.

USER QUERY: "{user_query}"

TASK:
Provide helpful nutritional information, but you MUST:
1. State clearly this is an ESTIMATE
2. Give approximate ranges (not exact numbers)
3. Explain what the dish typically contains
4. Provide general nutritional context
5. Suggest similar dishes in Indian cuisine

FORMAT YOUR RESPONSE:

**About {user_query}:**
[Brief description of the dish]

**Estimated Nutrition (per serving):**
 These are approximate values based on typical recipes
- Calories: ~[range] kcal
- Protein: ~[range]g
- Carbohydrates: ~[range]g  
- Fats: ~[range]g
- Fiber: ~[range]g

**Key Ingredients:**
[List main ingredients]

**Nutritional Highlights:**
[What's good/noteworthy about this dish]

**Similar Dishes in Database:**
[Suggest 2-3 similar dishes we DO have data for]

**Disclaimer:**
These values are estimates. For precise nutrition data, consult a nutritionist or use dishes from our verified database.
"""

        response = self.llm.generate(prompt)

        return {
            "recipe_name": f"{user_query} (Estimated)",
            "nutrition": {
                " Estimated Values": "See below"
            },
            "ingredients": "See estimated details below",
            "instructions": "Not available - estimated dish",
            "llm_response": response,
            "pathway": "extraction",
            "estimated": True,
            "accuracy": 50.0,
            "source": "llm_estimation"
        }

    def _format_nutrition(self, nutrition: dict) -> str:
        """Helper to format nutrition dict for LLM prompts"""
        lines = []
        for key, value in nutrition.items():
            lines.append(f"- {key}: {value}")
        return "\n".join(lines)

    # Async variants.
    # Each mirrors its sync counterpart but calls generate_async via httpx
    # so the Ollama HTTP call does not block the event loop.

    async def estimate_single_dish_nutrition_async(self, dish_name: str) -> dict:
        """
        Async variant of estimate_single_dish_nutrition.
        Uses Ollama JSON mode + NutritionEstimate validation.
        """
        prompt = f"""You are a nutrition expert. Estimate nutrition for this Indian dish.

DISH: {dish_name}

Return a JSON object with EXACTLY these keys for one typical serving.
All values must be plain numbers (no units, no strings):

{{
  "calories": <number>,
  "protein": <number>,
  "carbohydrates": <number>,
  "fats": <number>,
  "fiber": <number>
}}

Base estimates on typical Indian recipes and a standard single-portion serving size."""

        try:
            data = await self.llm.generate_json_async(prompt)
            model = NutritionEstimate(**data)
            return {
                "Calories": f"{model.calories} kcal",
                "Protein": f"{model.protein}g",
                "Carbohydrates": f"{model.carbohydrates}g",
                "Fats": f"{model.fats}g",
                "Fiber": f"{model.fiber}g",
            }
        except (ValidationError, KeyError, Exception):
            return dict(self._NUTRITION_FALLBACK)

    async def modify_recipe_async(
        self,
        dish_name: str,
        nutrition: dict,
        ingredients: str,
        method: str,
        user_constraint: str,
    ) -> dict:
        prompt = f"""You are a nutrition expert. Modify this recipe based on the user's request.

ORIGINAL RECIPE:
Dish: {dish_name}

Nutrition (per serving):
{self._format_nutrition(nutrition)}

Ingredients:
{ingredients}

Cooking Method:
{method}

USER REQUEST:
{user_constraint}

TASK:
1. Suggest ingredient substitutions to meet the constraint
2. Modify the cooking method if needed
3. Explain how this affects nutrition (qualitatively - do NOT invent exact numbers)
4. Keep the dish recognizable

FORMAT YOUR RESPONSE CLEARLY WITH SECTIONS:
**Modified Ingredients:**
[List changes here]

**Modified Cooking Method:**
[Describe changes here]

**Nutritional Impact:**
[Explain how nutrition changes - use terms like "reduced", "lower", "higher" - NO exact numbers]

**Tips:**
[Any additional advice]
"""
        response = await self.llm.generate_async(prompt)

        return {
            "recipe_name": f"{dish_name} ({user_constraint})",
            "nutrition": nutrition,
            "ingredients": "See modified version below",
            "instructions": "See modified version below",
            "llm_response": response,
            "pathway": "modification",
            "constraint": user_constraint,
            "estimated": False,
            "source": "dataset + llm_modification",
        }

    async def compare_dishes_async(
        self,
        dish_a: str,
        nutrition_a: dict,
        dish_b: str,
        nutrition_b: dict,
        user_goal: str | None = None,
        is_a_estimated: bool = False,
        is_b_estimated: bool = False,
    ) -> dict:
        estimation_note = ""
        if is_a_estimated and is_b_estimated:
            estimation_note = "⚠ Both sets of values are estimates — actual nutrition may vary by recipe or brand."
        elif is_a_estimated:
            estimation_note = f"⚠ {dish_a} values are estimated — actual nutrition may vary."
        elif is_b_estimated:
            estimation_note = f"⚠ {dish_b} values are estimated — actual nutrition may vary."

        goal_label = user_goal if user_goal else "general healthy eating"

        prompt = f"""You are NutriVerse, a nutrition intelligence assistant. Compare two foods using ONLY the data provided below. Never invent numbers.

FOOD A — {dish_a}
{self._format_nutrition(nutrition_a)}

FOOD B — {dish_b}
{self._format_nutrition(nutrition_b)}

HEALTH GOAL: {goal_label}
{estimation_note}

Write a focused, decisive comparison. Cite the actual values from the data. Be specific — users are making a food choice right now.

Use exactly these sections:

**Quick Verdict**
One sentence naming the better choice for {goal_label} and the single strongest reason.

**Nutritional Breakdown**
Compare each nutrient directly using the numbers above:
- Calories: [A value] vs [B value] — [which is lower/higher and what it means]
- Protein: [A value] vs [B value] — [satiety/muscle impact]
- Carbohydrates: [A value] vs [B value] — [energy/blood sugar impact]
- Fats: [A value] vs [B value] — [note if saturated fat data is available]
- Fibre: [A value] vs [B value] — [digestion/satiety impact]

**What This Means For You**
2–3 sentences: practical context for someone with the goal of {goal_label}. When should they pick A? When should they pick B?

**Bottom Line**
Choose **{dish_a}** if [specific condition].
Choose **{dish_b}** if [specific condition].
"""
        response = await self.llm.generate_async(prompt)

        return {
            "dish_a": dish_a,
            "nutrition_a": nutrition_a,
            "dish_b": dish_b,
            "nutrition_b": nutrition_b,
            "llm_response": response,
            "pathway": "comparison",
            "goal": user_goal,
            "estimated": is_a_estimated or is_b_estimated,
            "accuracy": 85.0 if not (is_a_estimated or is_b_estimated) else 60.0,
            "source": (
                "dataset + llm_comparison"
                if not (is_a_estimated or is_b_estimated)
                else "mixed/estimated + llm_comparison"
            ),
        }

    async def estimate_nutrition_async(self, user_query: str) -> dict:
        prompt = f"""You are a nutrition expert. The user asked about a dish not in our database.

USER QUERY: "{user_query}"

TASK:
Provide helpful nutritional information, but you MUST:
1. State clearly this is an ESTIMATE
2. Give approximate ranges (not exact numbers)
3. Explain what the dish typically contains
4. Provide general nutritional context
5. Suggest similar dishes in Indian cuisine

FORMAT YOUR RESPONSE:

**About {user_query}:**
[Brief description of the dish]

**Estimated Nutrition (per serving):**
 These are approximate values based on typical recipes
- Calories: ~[range] kcal
- Protein: ~[range]g
- Carbohydrates: ~[range]g
- Fats: ~[range]g
- Fiber: ~[range]g

**Key Ingredients:**
[List main ingredients]

**Nutritional Highlights:**
[What's good/noteworthy about this dish]

**Similar Dishes in Database:**
[Suggest 2-3 similar dishes we DO have data for]

**Disclaimer:**
These values are estimates. For precise nutrition data, consult a nutritionist or use dishes from our verified database.
"""
        response = await self.llm.generate_async(prompt)

        return {
            "recipe_name": f"{user_query} (Estimated)",
            "nutrition": {" Estimated Values": "See below"},
            "ingredients": "See estimated details below",
            "instructions": "Not available - estimated dish",
            "llm_response": response,
            "pathway": "extraction",
            "estimated": True,
            "accuracy": 50.0,
            "source": "llm_estimation",
        }