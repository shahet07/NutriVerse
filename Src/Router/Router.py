from __future__ import annotations

import asyncio
import json
import re
import traceback

from Src.Pathway_1.pathway1 import pathway_1_lookup as search_recipe
from Src.Pathway_1.pathway1_products import pathway_1_product_lookup as search_product

# ── Product / packaged-food detection keywords ─────────────────────────────
# If a dish name contains any of these tokens we prefer the FoodProduct cluster.
# Only include packaging/commercial terms — NOT ingredients that also appear in
# home-cooked Indian recipes (e.g. paneer, butter, ghee, oil).
PRODUCT_KEYWORDS: set[str] = {
    # Packaging / format signals
    "packet", "packaged", "brand", "bottle", "can", "tin", "box",
    "sachet", "pouch",
    # Commercial-only product categories
    "chips", "biscuit", "biscuits", "cookie", "cookies", "cereal",
    "instant",                         # "instant noodles", "instant oats"
    "ready",                           # "ready-to-eat"
    "chocolate", "candy", "toffee",
    "juice", "drink", "soda", "cola",  # beverages
    "energy drink",
    "sauce", "ketchup", "jam",         # processed condiments (not curry-sauce)
    "spread",
    "powder",                          # protein powder, health drink powder
    "snack",
}

# Known Indian + global brand indicators (a subset used for fast detection)
BRAND_INDICATORS: set[str] = {
    "amul", "britannia", "maggi", "nestle", "unilever",
    "parle", "haldirams", "haldiram", "lays", "kellogs",
    "kelloggs", "patanjali", "dabur", "mother dairy", "anand",
    "itc", "mondelez", "cadbury", "pepsico", "coca cola",
}


COMPARE_PATTERNS = [
    r'\bvs\.?\b', r'\bversus\b', r'\bcompare\b', r'\bcomparison\b',
    r'\bbetter\s+than\b', r'\bhealthier\s+than\b',
    r'\bor\b(?=.*\b(?:which|healthier|better|calories)\b)',
]

MODIFY_KEYWORDS = [
    'less', 'low', 'reduce', 'without', 'no ', 'vegan', 'vegetarian',
    'healthy version', 'healthier', 'substitute', 'replace', 'gluten free',
    'sugar free', 'keto', 'diet', 'light version', 'make it',
    'calorie', 'protein rich', 'high protein', 'low fat', 'low carb',
    'oil free', 'dairy free',
]

SEARCH_KEYWORDS = [
    'suggest', 'recommend', 'ideas for', 'recipes with', 'what can i make',
    'show me some', 'find', 'search for', 'options for', 'list of',
    'dishes with', 'give me some',
]

# Semantic search patterns — queries that describe a category or dietary goal
# rather than a specific named dish. These should route to the GraphRAG search.
SEARCH_QUALIFIER_PATTERNS = [
    r'\b(high|low|rich)\s+(protein|calorie|carb|fat|fibre|fiber|sodium|sugar)\b',
    r'\b(keto|paleo|diabetic|vegan|vegetarian|gluten\s*free)\s+(friendly|safe)?\s*(breakfast|lunch|dinner|snack|meal|dish|recipe|food|dessert|sweet|drink|option)s?\b',
    r'\b(breakfast|lunch|dinner|snack|dessert|sweet|appetizer|starter|side\s*dish)\s+(idea|option|recipe|suggestion|recommendation)s?\b',
    r'\b(healthy|light|quick|easy|simple|protein.?rich|fibre.?rich|iron.?rich)\s+(breakfast|lunch|dinner|snack|meal|dish|recipe|food|dessert|option)s?\b',
    r'\b(diabetic\s+friendly|heart\s+healthy)\b',
]

SEARCH_QUALIFIER_REGEX = re.compile('|'.join(SEARCH_QUALIFIER_PATTERNS), re.IGNORECASE)

COMPARE_REGEX = re.compile('|'.join(COMPARE_PATTERNS), re.IGNORECASE)


class NutriSenseRouter:
    def __init__(self, neo4j_client, llm_engine, image_model=None, graph_rag_service=None, voice_llm=None):
        self.neo4j_client = neo4j_client
        self.engine = llm_engine
        self.image_model = image_model
        self.graph_rag_service = graph_rag_service
        # Separate fast client for voice/chat endpoints (Groq).
        # Falls back to the engine's LLM if not provided.
        self.voice_llm = voice_llm or llm_engine.llm

    # ─────────────────────────────────────────────────────────────────────
    # Cluster detection helpers
    # ─────────────────────────────────────────────────────────────────────

    @staticmethod
    def _detect_cluster(dish_name: str) -> str:
        """
        Heuristic: return "product" if the dish name looks like a packaged
        food brand / commercial item, otherwise return "recipe".
        """
        tokens = set(dish_name.lower().split())
        if tokens & BRAND_INDICATORS:
            return "product"
        if tokens & PRODUCT_KEYWORDS:
            return "product"
        return "recipe"

    def _lookup_by_cluster(self, name: str, cluster: str) -> dict:
        """Dispatch to the correct pathway based on *cluster*."""
        if cluster == "product":
            return search_product(name, self.neo4j_client)
        return search_recipe(name, self.neo4j_client)

    async def _async_lookup_by_cluster(self, name: str, cluster: str) -> dict:
        if cluster == "product":
            return await asyncio.to_thread(search_product, name, self.neo4j_client)
        return await asyncio.to_thread(search_recipe, name, self.neo4j_client)

    def _rule_based_classify(self, query: str):
        q = query.lower().strip()

        if ' and ' in q:
            dishes = self._extract_compare_dishes(q)
            if dishes and len(dishes) == 2:
                if len(dishes[0]) > 2 and len(dishes[1]) > 2:
                    return {"pathway": "COMPARE", "dishes": dishes, "constraint": None}

        if COMPARE_REGEX.search(q):
            dishes = self._extract_compare_dishes(q)
            if dishes and len(dishes) >= 2:
                return {"pathway": "COMPARE", "dishes": dishes, "constraint": None}

        for kw in MODIFY_KEYWORDS:
            if kw in q:
                dish = self._extract_dish_for_modify(q, kw)
                constraint = self._extract_constraint(q)
                return {
                    "pathway": "MODIFY",
                    "dishes": [dish] if dish else [q],
                    "constraint": constraint,
                }

        for kw in SEARCH_KEYWORDS:
            if kw in q:
                return {"pathway": "SEARCH", "dishes": [q], "constraint": None}

        # Semantic search patterns — e.g. "high protein breakfast", "keto snacks"
        if SEARCH_QUALIFIER_REGEX.search(q):
            return {"pathway": "SEARCH", "dishes": [q], "constraint": None}

        dish = self._clean_dish_name(q)
        return {"pathway": "EXTRACT", "dishes": [dish if dish else q], "constraint": None}

    def _extract_compare_dishes(self, q: str):
        for splitter in [r'\s+vs\.?\s+', r'\s+versus\s+', r'\s+compare\s+',
                         r'\s+better\s+than\s+', r'\s+healthier\s+than\s+',
                         r'\s+and\s+', r'\s+or\s+']:
            parts = re.split(splitter, q, maxsplit=1, flags=re.IGNORECASE)
            if len(parts) == 2:
                a = self._clean_dish_name(parts[0])
                b = self._clean_dish_name(parts[1])
                if a and b:
                    return [a, b]
        return None

    @staticmethod
    def _extract_dish_for_modify(q: str, keyword: str):
        idx = q.find(keyword)
        before = q[:idx].strip() if idx > 0 else ""
        for filler in ['make', 'prepare', 'cook', 'give me', 'i want', 'can you', 'how to', 'create',
                        'with', 'that is', 'to be', 'to', 'which is', 'which should be']:
            before = re.sub(rf'\b{filler}\b', '', before, flags=re.IGNORECASE).strip()
        return before if before else q

    @staticmethod
    def _extract_constraint(q: str):
        for kw in MODIFY_KEYWORDS:
            if kw in q:
                idx = q.find(kw)
                return q[idx:].strip()
        return q

    @staticmethod
    def _clean_dish_name(text: str):
        text = text.strip()
        for filler in ['what is in', 'what is', 'nutrition of', 'nutrients in',
                       'tell me about', 'details of', 'info about', 'about',
                       'how much', 'nutritional value of', 'give me',
                       'i want', 'show me', 'compare', 'which is']:
            text = re.sub(rf'\b{filler}\b', '', text, flags=re.IGNORECASE).strip()
        return text

    def classify_intent(self, query):
        if not query or query.strip() == "":
            return {"pathway": "EXTRACT", "dishes": [""], "constraint": None}

        result = self._rule_based_classify(query)
        if result:
            print(f"[Router] {result['pathway']} | Dishes: {result['dishes']}")
            return result

        return self._llm_classify(query)

    def _llm_classify(self, query):
        prompt = f"""Analyze this food-related user query and classify its intent.

Query: "{query}"

Categories:
- "EXTRACT": User is asking about ONE specific food/dish (this is the DEFAULT)
- "COMPARE": User EXPLICITLY asks to compare TWO or more foods (must use words like "vs", "compare", "versus", "or which is better")
- "MODIFY": User wants to change/modify a recipe (must use words like "less", "low", "without", "vegan", "healthier version")
- "SEARCH": User is looking for recommendations, multiple dishes, dietary-category queries (e.g. "high protein breakfast", "keto snacks", "diabetic friendly desserts"), or asking for recipes containing specific generic ingredients (e.g. "suggest", "ideas for", "recipes with chicken")

CRITICAL RULES:
1. If the query mentions only ONE exact dish for info, ALWAYS return EXTRACT — never invent a second dish
2. COMPARE requires the user to EXPLICITLY name two dishes
3. If the query asks for ideas, suggestions, uses dietary qualifiers (high protein, low calorie, keto, vegan, diabetic friendly) combined with meal types (breakfast, snack, dessert), or mentions ingredients rather than a specific dish, return SEARCH
4. When in doubt, choose EXTRACT
5. The "dishes" array must contain ONLY dishes that the user actually mentioned

Return ONLY valid JSON (no markdown, no explanation):
{{"pathway": "EXTRACT", "dishes": ["dish name"], "constraint": null}}"""

        try:
            response = self.engine.llm.generate(prompt)

            json_start = response.find("{")
            json_end = response.rfind("}") + 1

            if json_start != -1 and json_end > json_start:
                data = json.loads(response[json_start:json_end])

                pathway = data.get('pathway', 'EXTRACT')
                dishes = data.get('dishes', [query])
                constraint = data.get('constraint')

                if pathway == "COMPARE" and len(dishes) < 2:
                    pathway = "EXTRACT"

                if pathway == "COMPARE" and len(dishes) >= 2:
                    q_lower = query.lower()
                    hallucinated = [d for d in dishes if d.lower() not in q_lower]
                    if hallucinated:
                        pathway = "EXTRACT"
                        dishes = [d for d in dishes if d.lower() in q_lower] or [query]

                result = {
                    "pathway": pathway,
                    "dishes": dishes if dishes else [query],
                    "constraint": constraint,
                }
                print(f"[Router] {result['pathway']} | Dishes: {result['dishes']}")
                return result
            else:
                raise ValueError("No valid JSON in LLM response")

        except Exception as e:
            print(f"[Router] Classification error: {e}, defaulting to EXTRACT")
            return {"pathway": "EXTRACT", "dishes": [query], "constraint": None}
        
    def execute(self, text_query=None, image_input=None):
        try:
            if image_input is not None:
                top_predictions = self.image_model.predict(image_input)
                return self.handle_image_extraction(top_predictions)

            if not text_query or text_query.strip() == "":
                return {
                    'error': 'Please provide a valid query',
                    'llm_response': 'I need a question about food to help you!'
                }

            intent = self.classify_intent(text_query)
            dishes = intent.get('dishes', [])
            constraint = intent.get('constraint')
            pathway = intent.get('pathway', 'EXTRACT')

            if pathway == "COMPARE" and len(dishes) >= 2:
                return self.handle_comparison(dishes, constraint)
            elif pathway == "MODIFY":
                target_dish = dishes[0] if dishes else text_query
                return self.handle_modification(target_dish, constraint)
            elif pathway == "SEARCH":
                return self.handle_search(text_query)
            else:
                target = dishes[0] if dishes else text_query
                return self.handle_extraction(target)

        except Exception as e:
            traceback.print_exc()
            return {
                'error': str(e),
                'llm_response': f'An error occurred: {str(e)}'
            }

    def handle_extraction(self, name, override_conf=None):
        try:
            if not name or name.strip() == "":
                return self.engine.estimate_nutrition("general healthy meal")

            # Detect cluster and route to the appropriate lookup
            cluster = self._detect_cluster(name)
            res = self._lookup_by_cluster(name, cluster)

            # If product cluster returns NOT_FOUND, fall back to recipe cluster
            if cluster == "product" and (not res or res.get("status") != "FOUND"):
                res = search_recipe(name, self.neo4j_client)
                cluster = "recipe"

            if res and res.get('status') == "FOUND" and res.get('results'):
                out = res['results'][0].copy()
                out['pathway'] = 'extraction'
                out['cluster'] = res.get('cluster', cluster)
                if override_conf is not None:
                    out['accuracy'] = float(override_conf * 100)
                elif 'confidence' in out:
                    out['accuracy'] = float(out['confidence'] * 100)
                else:
                    out['accuracy'] = 85.0

                # Include up to 3 variant results for top-N display
                variants = []
                for r in res['results'][1:4]:
                    v = r.copy()
                    v['pathway'] = 'extraction'
                    v['cluster'] = res.get('cluster', cluster)
                    if 'confidence' in v:
                        v['accuracy'] = float(v['confidence'] * 100)
                    variants.append(v)
                out['variants'] = variants

                return out

            return self.engine.estimate_nutrition(name)

        except Exception:
            return self.engine.estimate_nutrition(name)

    def handle_image_extraction(self, predictions: list) -> dict:
        image_predictions = [
            {"label": label, "score": round(score, 4)} for label, score in predictions
        ]
        try:
            for label, score in predictions:
                cluster = self._detect_cluster(label)
                res = self._lookup_by_cluster(label, cluster)
                if cluster == "product" and (not res or res.get("status") != "FOUND"):
                    res = search_recipe(label, self.neo4j_client)
                    cluster = "recipe"
                if res and res.get("status") == "FOUND" and res.get("results"):
                    out = res["results"][0].copy()
                    out["pathway"] = "extraction"
                    out["cluster"] = res.get("cluster", cluster)
                    out["accuracy"] = float(score * 100)
                    variants = []
                    for r in res["results"][1:4]:
                        v = r.copy()
                        v["pathway"] = "extraction"
                        v["cluster"] = res.get("cluster", cluster)
                        if "confidence" in v:
                            v["accuracy"] = float(v["confidence"] * 100)
                        variants.append(v)
                    out["variants"] = variants
                    out["meta"] = {**out.get("meta", {}), "image_predictions": image_predictions}
                    return out
            top_label, _ = predictions[0]
            result = self.engine.estimate_nutrition(top_label)
            result["meta"] = {**result.get("meta", {}), "image_predictions": image_predictions}
            return result
        except Exception:
            top_label, _ = predictions[0]
            return self.engine.estimate_nutrition(top_label)

    def handle_modification(self, name, constraint):
        try:
            if not name or name.strip() == "":
                return {
                    'error': 'No dish specified',
                    'llm_response': 'Please specify which dish you want to modify.'
                }

            res = search_recipe(name, self.neo4j_client)

            if res and res.get('status') == "FOUND" and res.get('results'):
                d = res['results'][0]
                out = self.engine.modify_recipe(
                    d.get('recipe_name', name),
                    d.get('nutrition', {}),
                    d.get('ingredients', 'Not available'),
                    d.get('instructions', 'Not available'),
                    constraint
                )
                out['accuracy'] = float(d.get('confidence', 0.85) * 100)
                return out

            constraint_text = f" with {constraint}" if constraint else ""
            return self.engine.estimate_nutrition(f"{name}{constraint_text}")

        except Exception:
            constraint_text = f" with {constraint}" if constraint else ""
            return self.engine.estimate_nutrition(f"{name}{constraint_text}")

    def handle_comparison(self, dishes, goal):
        try:
            if len(dishes) < 2:
                return {
                    'error': 'Need two dishes to compare',
                    'llm_response': 'Please specify two dishes to compare.'
                }

            # Detect cluster for each dish (enables cross-cluster comparisons)
            cluster_a = self._detect_cluster(dishes[0])
            cluster_b = self._detect_cluster(dishes[1])

            res_a = self._lookup_by_cluster(dishes[0], cluster_a)
            # If product search fails, fall back to recipe
            if cluster_a == "product" and (not res_a or res_a.get("status") != "FOUND"):
                res_a = search_recipe(dishes[0], self.neo4j_client)
                cluster_a = "recipe"

            found_a = res_a and res_a.get('status') == "FOUND" and res_a.get('results')

            if found_a:
                r0 = res_a['results'][0]
                dish_a_name = r0.get('recipe_name') or r0.get('product_name', dishes[0])
                nutrition_a = r0.get('nutrition', {})
                is_a_estimated = False
            else:
                dish_a_name = dishes[0]
                nutrition_a = self.engine.estimate_single_dish_nutrition(dishes[0])
                is_a_estimated = True

            res_b = self._lookup_by_cluster(dishes[1], cluster_b)
            if cluster_b == "product" and (not res_b or res_b.get("status") != "FOUND"):
                res_b = search_recipe(dishes[1], self.neo4j_client)
                cluster_b = "recipe"

            found_b = res_b and res_b.get('status') == "FOUND" and res_b.get('results')

            if found_b:
                r1 = res_b['results'][0]
                dish_b_name = r1.get('recipe_name') or r1.get('product_name', dishes[1])
                nutrition_b = r1.get('nutrition', {})
                is_b_estimated = False
            else:
                dish_b_name = dishes[1]
                nutrition_b = self.engine.estimate_single_dish_nutrition(dishes[1])
                is_b_estimated = True

            out = self.engine.compare_dishes(
                dish_a_name, nutrition_a,
                dish_b_name, nutrition_b,
                goal,
                is_a_estimated=is_a_estimated,
                is_b_estimated=is_b_estimated
            )

            if not is_a_estimated and not is_b_estimated:
                conf_a = res_a['results'][0].get('confidence', 0.85)
                conf_b = res_b['results'][0].get('confidence', 0.85)
                out['accuracy'] = float((conf_a + conf_b) / 2 * 100)
            elif is_a_estimated and is_b_estimated:
                out['accuracy'] = 55.0
            else:
                out['accuracy'] = 70.0

            return out

        except Exception:
            traceback.print_exc()
            goal_text = f" for {goal}" if goal else ""
            return self.engine.estimate_nutrition(f"Compare {dishes[0]} and {dishes[1]}{goal_text}")

    def handle_search(self, query):
        if not self.graph_rag_service:
            return {"error": "Search service is not initialized"}
        
        try:
            results = self.graph_rag_service.search(
                query=query,
                cluster="all",
                limit=10,
            )
            return {
                "pathway": "search",
                "query": query,
                "results": results,
                "total": len(results),
                "llm_response": f"I found {len(results)} suggestions for '{query}'.",
            }
        except Exception as e:
            traceback.print_exc()
            return {"error": str(e), "llm_response": f"An error occurred during search: {e}"}

    # Async execute methods.
    # Neo4j queries and TF inference run in a thread pool via asyncio.to_thread.
    # LLM calls use generate_async (httpx) and do not block the event loop.

    async def execute_async(
        self, text_query: str = "", image_input: str | None = None
    ) -> dict:
        try:
            if image_input is not None:
                top_predictions = await asyncio.to_thread(
                    self.image_model.predict, image_input
                )
                return await self._async_handle_image_extraction(top_predictions)

            if not text_query or text_query.strip() == "":
                return {
                    "error": "Please provide a valid query",
                    "llm_response": "I need a question about food to help you!",
                }

            # classify_intent may fall back to the sync LLM — run in a thread
            intent = await asyncio.to_thread(self.classify_intent, text_query)
            dishes = intent.get("dishes", [])
            constraint = intent.get("constraint")
            pathway = intent.get("pathway", "EXTRACT")

            if pathway == "COMPARE" and len(dishes) >= 2:
                return await self._async_handle_comparison(dishes, constraint)
            elif pathway == "MODIFY":
                target = dishes[0] if dishes else text_query
                return await self._async_handle_modification(target, constraint)
            elif pathway == "SEARCH":
                return await self._async_handle_search(text_query)
            else:
                target = dishes[0] if dishes else text_query
                return await self._async_handle_extraction(target)

        except Exception as exc:
            traceback.print_exc()
            return {"error": str(exc), "llm_response": f"An error occurred: {exc}"}

    async def _async_handle_extraction(
        self, name: str, override_conf: float | None = None
    ) -> dict:
        try:
            if not name or name.strip() == "":
                return await self.engine.estimate_nutrition_async("general healthy meal")

            cluster = self._detect_cluster(name)
            res = await self._async_lookup_by_cluster(name, cluster)

            # Fall back to recipe cluster if product search misses
            if cluster == "product" and (not res or res.get("status") != "FOUND"):
                res = await asyncio.to_thread(search_recipe, name, self.neo4j_client)
                cluster = "recipe"

            if res and res.get("status") == "FOUND" and res.get("results"):
                out = res["results"][0].copy()
                out["pathway"] = "extraction"
                out["cluster"] = res.get("cluster", cluster)
                if override_conf is not None:
                    out["accuracy"] = float(override_conf * 100)
                elif "confidence" in out:
                    out["accuracy"] = float(out["confidence"] * 100)
                else:
                    out["accuracy"] = 85.0

                # Include up to 3 variant results for top-N display
                variants = []
                for r in res["results"][1:4]:
                    v = r.copy()
                    v["pathway"] = "extraction"
                    v["cluster"] = res.get("cluster", cluster)
                    if "confidence" in v:
                        v["accuracy"] = float(v["confidence"] * 100)
                    variants.append(v)
                out["variants"] = variants

                return out

            return await self.engine.estimate_nutrition_async(name)

        except Exception:
            return await self.engine.estimate_nutrition_async(name)

    async def _async_handle_image_extraction(self, predictions: list) -> dict:
        image_predictions = [
            {"label": label, "score": round(score, 4)} for label, score in predictions
        ]
        try:
            for label, score in predictions:
                cluster = self._detect_cluster(label)
                res = await self._async_lookup_by_cluster(label, cluster)
                if cluster == "product" and (not res or res.get("status") != "FOUND"):
                    res = await asyncio.to_thread(search_recipe, label, self.neo4j_client)
                    cluster = "recipe"
                if res and res.get("status") == "FOUND" and res.get("results"):
                    out = res["results"][0].copy()
                    out["pathway"] = "extraction"
                    out["cluster"] = res.get("cluster", cluster)
                    out["accuracy"] = float(score * 100)
                    variants = []
                    for r in res["results"][1:4]:
                        v = r.copy()
                        v["pathway"] = "extraction"
                        v["cluster"] = res.get("cluster", cluster)
                        if "confidence" in v:
                            v["accuracy"] = float(v["confidence"] * 100)
                        variants.append(v)
                    out["variants"] = variants
                    out["meta"] = {**out.get("meta", {}), "image_predictions": image_predictions}
                    return out
            top_label, _ = predictions[0]
            result = await self.engine.estimate_nutrition_async(top_label)
            result["meta"] = {**result.get("meta", {}), "image_predictions": image_predictions}
            return result
        except Exception:
            top_label, _ = predictions[0]
            return await self.engine.estimate_nutrition_async(top_label)

    async def _async_handle_modification(self, name: str, constraint: str) -> dict:
        try:
            if not name or name.strip() == "":
                return {
                    "error": "No dish specified",
                    "llm_response": "Please specify which dish you want to modify.",
                }

            res = await asyncio.to_thread(search_recipe, name, self.neo4j_client)

            if res and res.get("status") == "FOUND" and res.get("results"):
                d = res["results"][0]
                out = await self.engine.modify_recipe_async(
                    d.get("recipe_name", name),
                    d.get("nutrition", {}),
                    d.get("ingredients", "Not available"),
                    d.get("instructions", "Not available"),
                    constraint,
                )
                out["accuracy"] = float(d.get("confidence", 0.85) * 100)
                return out

            constraint_text = f" with {constraint}" if constraint else ""
            return await self.engine.estimate_nutrition_async(f"{name}{constraint_text}")

        except Exception:
            constraint_text = f" with {constraint}" if constraint else ""
            return await self.engine.estimate_nutrition_async(f"{name}{constraint_text}")

    async def _async_handle_comparison(self, dishes: list, goal: str) -> dict:
        try:
            if len(dishes) < 2:
                return {
                    "error": "Need two dishes to compare",
                    "llm_response": "Please specify two dishes to compare.",
                }

            cluster_a = self._detect_cluster(dishes[0])
            cluster_b = self._detect_cluster(dishes[1])

            res_a, res_b = await asyncio.gather(
                self._async_lookup_by_cluster(dishes[0], cluster_a),
                self._async_lookup_by_cluster(dishes[1], cluster_b),
            )

            # Fallbacks if product cluster misses
            if cluster_a == "product" and (not res_a or res_a.get("status") != "FOUND"):
                res_a = await asyncio.to_thread(search_recipe, dishes[0], self.neo4j_client)
            if cluster_b == "product" and (not res_b or res_b.get("status") != "FOUND"):
                res_b = await asyncio.to_thread(search_recipe, dishes[1], self.neo4j_client)

            found_a = res_a and res_a.get("status") == "FOUND" and res_a.get("results")
            found_b = res_b and res_b.get("status") == "FOUND" and res_b.get("results")

            if found_a:
                r0 = res_a["results"][0]
                dish_a_name = r0.get("recipe_name") or r0.get("product_name", dishes[0])
                nutrition_a = r0.get("nutrition", {})
                is_a_estimated = False
            else:
                dish_a_name = dishes[0]
                nutrition_a = await self.engine.estimate_single_dish_nutrition_async(dishes[0])
                is_a_estimated = True

            if found_b:
                r1 = res_b["results"][0]
                dish_b_name = r1.get("recipe_name") or r1.get("product_name", dishes[1])
                nutrition_b = r1.get("nutrition", {})
                is_b_estimated = False
            else:
                dish_b_name = dishes[1]
                nutrition_b = await self.engine.estimate_single_dish_nutrition_async(dishes[1])
                is_b_estimated = True

            out = await self.engine.compare_dishes_async(
                dish_a_name, nutrition_a,
                dish_b_name, nutrition_b,
                goal,
                is_a_estimated=is_a_estimated,
                is_b_estimated=is_b_estimated,
            )

            if not is_a_estimated and not is_b_estimated:
                conf_a = res_a["results"][0].get("confidence", 0.85)
                conf_b = res_b["results"][0].get("confidence", 0.85)
                out["accuracy"] = float((conf_a + conf_b) / 2 * 100)
            elif is_a_estimated and is_b_estimated:
                out["accuracy"] = 55.0
            else:
                out["accuracy"] = 70.0

            return out

        except Exception:
            traceback.print_exc()
            goal_text = f" for {goal}" if goal else ""
            return await self.engine.estimate_nutrition_async(
                f"Compare {dishes[0]} and {dishes[1]}{goal_text}"
            )

    async def _async_handle_search(self, query: str) -> dict:
        if not self.graph_rag_service:
            return {"error": "Search service is not initialized"}
        
        try:
            results = await self.graph_rag_service.search_async(
                query=query,
                cluster="all",
                limit=10,
            )
            return {
                "pathway": "search",
                "query": query,
                "results": results,
                "total": len(results),
                "llm_response": f"I found {len(results)} suggestions for '{query}'.",
            }
        except Exception as exc:
            traceback.print_exc()
            return {"error": str(exc), "llm_response": f"An error occurred during search: {exc}"}
