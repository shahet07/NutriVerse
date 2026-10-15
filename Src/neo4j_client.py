
import os
import uuid
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()



class Neo4jClient:
    def __init__(self, uri: str = None, user: str = None, password: str = None):
        self.uri = uri or os.getenv("NEO4J_URI")
        self.user = user or os.getenv("NEO4J_USER")
        self.password = password or os.getenv("NEO4J_PASSWORD")
        if not all([self.uri, self.user, self.password]):
            raise ValueError(
                "Neo4j credentials not found. Please set NEO4J_URI, "
                "NEO4J_USER, and NEO4J_PASSWORD environment variables."
            )
        self.driver = GraphDatabase.driver(
            self.uri,
            auth=(self.user, self.password),
            # Recycle connections every 3 min — well before Azure's ~8 min
            # idle TCP timeout that causes "defunct connection" 503s.
            max_connection_lifetime=180,
            # Ping a pooled connection before using it; if dead, get a fresh one.
            liveness_check_timeout=20,
            keep_alive=True,
        )
        self._verify_connection()

    def _verify_connection(self):
        try:
            self.driver.verify_connectivity()
        except Exception as e:
            raise ConnectionError(f"Failed to connect to Neo4j: {e}")

    def ensure_indexes(self) -> None:
        """
        Create indexes/constraints needed for efficient interaction tracking.
        Uses CREATE ... IF NOT EXISTS so it is safe to call on every startup.
        """
        statements = [
            # Range indexes for fast id lookups in MATCH ... WHERE toString(item.id) = ...
            "CREATE INDEX recipe_id_idx IF NOT EXISTS FOR (r:Recipe) ON (r.id)",
            "CREATE INDEX product_id_idx IF NOT EXISTS FOR (fp:FoodProduct) ON (fp.id)",
            # Uniqueness constraint on User.id (also creates an index)
            "CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE",
        ]
        with self.driver.session() as session:
            for stmt in statements:
                try:
                    session.run(stmt)
                except Exception:
                    # Silently skip — Community Edition may not support
                    # some constraint types, but the index is the important part.
                    pass

    def close(self):
        if self.driver:
            self.driver.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def search_recipes_by_name(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                """
                CALL db.index.fulltext.queryNodes('recipe_name_fulltext', $search_term)
                YIELD node, score
                WITH node, score
                ORDER BY score DESC
                LIMIT $limit
                RETURN
                    node.id AS id,
                    node.name AS recipe_original,
                    node.food_name AS food_name,
                    node.serving_size_g AS serving_size_g,
                    node.prep_time_mins AS prep_time_mins,
                    node.instructions AS instructions,
                    node.raw_ingredients AS raw_ingredients,
                    node.calories AS calories,
                    node.carbohydrates AS carbohydrates,
                    node.protein AS protein,
                    node.fats AS fats,
                    node.free_sugar AS free_sugar,
                    node.fibre AS fibre,
                    node.sodium AS sodium,
                    node.calcium AS calcium,
                    node.iron AS iron,
                    node.vitamin_c AS vitamin_c,
                    node.folate AS folate,
                    score AS search_score
                ORDER BY score DESC
                """,
                search_term=query, limit=limit
            )
            recipes = []
            for record in result:
                recipes.append(dict(record))
            return recipes

    def get_recipe_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:Recipe {name: $name})
                RETURN
                    r.id AS id,
                    r.name AS recipe_original,
                    r.food_name AS food_name,
                    r.serving_size_g AS serving_size_g,
                    r.prep_time_mins AS prep_time_mins,
                    r.instructions AS instructions,
                    r.raw_ingredients AS raw_ingredients,
                    r.calories AS calories,
                    r.carbohydrates AS carbohydrates,
                    r.protein AS protein,
                    r.fats AS fats,
                    r.free_sugar AS free_sugar,
                    r.fibre AS fibre,
                    r.sodium AS sodium,
                    r.calcium AS calcium,
                    r.iron AS iron,
                    r.vitamin_c AS vitamin_c,
                    r.folate AS folate
                LIMIT 1
                """,
                name=name
            )
            record = result.single()
            return dict(record) if record else None

    def get_all_recipe_names(self) -> List[Dict[str, str]]:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:Recipe)
                RETURN r.name AS name, r.food_name AS food_name
                """
            )
            return [dict(record) for record in result]

    def get_recipe_by_food_name(self, food_name: str) -> List[Dict[str, Any]]:
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:Recipe)
                WHERE toLower(r.food_name) CONTAINS toLower($food_name)
                RETURN
                    r.id AS id,
                    r.name AS recipe_original,
                    r.food_name AS food_name,
                    r.serving_size_g AS serving_size_g,
                    r.prep_time_mins AS prep_time_mins,
                    r.instructions AS instructions,
                    r.raw_ingredients AS raw_ingredients,
                    r.calories AS calories,
                    r.carbohydrates AS carbohydrates,
                    r.protein AS protein,
                    r.fats AS fats,
                    r.free_sugar AS free_sugar,
                    r.fibre AS fibre,
                    r.sodium AS sodium,
                    r.calcium AS calcium,
                    r.iron AS iron,
                    r.vitamin_c AS vitamin_c,
                    r.folate AS folate
                """,
                food_name=food_name
            )
            return [dict(record) for record in result]

    def get_stats(self) -> Dict[str, int]:
        """Return aggregate node counts for both food clusters (used by /health endpoint)."""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:Recipe)       WITH count(r)  AS recipes
                MATCH (i:Ingredient)   WITH recipes,  count(i)  AS ingredients
                MATCH (ic:ImageClass)  WITH recipes,  ingredients, count(ic) AS image_classes
                MATCH (fp:FoodProduct) WITH recipes,  ingredients, image_classes, count(fp) AS food_products
                MATCH (b:Brand)        WITH recipes,  ingredients, image_classes, food_products, count(b) AS brands
                MATCH (cat:Category)   WITH recipes,  ingredients, image_classes, food_products, brands, count(cat) AS categories
                MATCH (at:AllergenTag) WITH recipes,  ingredients, image_classes, food_products, brands, categories, count(at) AS allergen_tags
                RETURN recipes, ingredients, image_classes,
                       food_products, brands, categories, allergen_tags
                """
            )
            record = result.single()
            return dict(record) if record else {
                "recipes": 0, "ingredients": 0, "image_classes": 0,
                "food_products": 0, "brands": 0, "categories": 0, "allergen_tags": 0,
            }


    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # Cluster B â€” FoodProduct queries
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def search_products_by_name(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Full-text search against the product_name_fulltext index (Cluster B)."""
        with self.driver.session() as session:
            result = session.run(
                """
                CALL db.index.fulltext.queryNodes('product_name_fulltext', $search_term)
                YIELD node, score
                ORDER BY score DESC
                LIMIT $limit
                OPTIONAL MATCH (node)-[:MADE_BY]->(b:Brand)
                OPTIONAL MATCH (node)-[:IN_CATEGORY]->(cat:Category)
                RETURN
                    node.id               AS id,
                    node.name             AS name,
                    node.generic_name     AS generic_name,
                    node.brand            AS brand,
                    node.category         AS category,
                    node.serving_size     AS serving_size,
                    node.serving_quantity AS serving_quantity,
                    node.nova_group       AS nova_group,
                    node.nutriscore_grade AS nutriscore_grade,
                    node.calories_100g    AS calories_100g,
                    node.fat_100g         AS fat_100g,
                    node.saturated_fat_100g AS saturated_fat_100g,
                    node.carbohydrates_100g AS carbohydrates_100g,
                    node.sugars_100g      AS sugars_100g,
                    node.fiber_100g       AS fiber_100g,
                    node.proteins_100g    AS proteins_100g,
                    node.sodium_100g      AS sodium_100g,
                    node.calcium_100g     AS calcium_100g,
                    node.iron_100g        AS iron_100g,
                    node.vitamin_c_100g   AS vitamin_c_100g,
                    node.folate_100g      AS folate_100g,
                    node.image_url        AS image_url,
                    b.name                AS brand_node,
                    cat.name              AS category_node,
                    score                 AS search_score
                ORDER BY score DESC
                """,
                search_term=query, limit=limit,
            )
            return [dict(r) for r in result]

    def get_product_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Case-insensitive substring match on FoodProduct.name (Cluster B)."""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (fp:FoodProduct)
                WHERE toLower(fp.name) CONTAINS toLower($name)
                OPTIONAL MATCH (fp)-[:MADE_BY]->(b:Brand)
                OPTIONAL MATCH (fp)-[:IN_CATEGORY]->(cat:Category)
                RETURN
                    fp.id               AS id,
                    fp.name             AS name,
                    fp.generic_name     AS generic_name,
                    fp.brand            AS brand,
                    fp.category         AS category,
                    fp.serving_size     AS serving_size,
                    fp.serving_quantity AS serving_quantity,
                    fp.nova_group       AS nova_group,
                    fp.nutriscore_grade AS nutriscore_grade,
                    fp.calories_100g    AS calories_100g,
                    fp.fat_100g         AS fat_100g,
                    fp.saturated_fat_100g AS saturated_fat_100g,
                    fp.carbohydrates_100g AS carbohydrates_100g,
                    fp.sugars_100g      AS sugars_100g,
                    fp.fiber_100g       AS fiber_100g,
                    fp.proteins_100g    AS proteins_100g,
                    fp.sodium_100g      AS sodium_100g,
                    fp.calcium_100g     AS calcium_100g,
                    fp.iron_100g        AS iron_100g,
                    fp.vitamin_c_100g   AS vitamin_c_100g,
                    fp.folate_100g      AS folate_100g,
                    fp.image_url        AS image_url,
                    b.name              AS brand_node,
                    cat.name            AS category_node
                LIMIT 1
                """,
                name=name,
            )
            record = result.single()
            return dict(record) if record else None

    def get_all_product_names(self) -> List[Dict[str, str]]:
        """Return all FoodProduct names (used by fuzzy lookup layer)."""
        with self.driver.session() as session:
            result = session.run(
                "MATCH (fp:FoodProduct) RETURN fp.id AS id, fp.name AS name, fp.brand AS brand"
            )
            return [dict(r) for r in result]

    def get_products_by_category(self, category: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Return products belonging to a given Category node (Cluster B)."""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (fp:FoodProduct)-[:IN_CATEGORY]->(cat:Category {name: $category})
                OPTIONAL MATCH (fp)-[:MADE_BY]->(b:Brand)
                RETURN fp.id AS id, fp.name AS name, fp.brand AS brand,
                       fp.calories_100g AS calories_100g, fp.proteins_100g AS proteins_100g,
                       fp.carbohydrates_100g AS carbohydrates_100g, fp.fat_100g AS fat_100g,
                       fp.nutriscore_grade AS nutriscore_grade, b.name AS brand_node
                LIMIT $limit
                """,
                category=category, limit=limit,
            )
            return [dict(r) for r in result]

    def get_allergen_info(self, item_name: str, is_product: bool = False) -> List[str]:
        """
        Return list of AllergenTag names for a Recipe or FoodProduct.
        Traverses: (node)-[:CONTAINS]->(Ingredient)-[:IS_ALLERGEN]->(AllergenTag)
        """
        label = "FoodProduct" if is_product else "Recipe"
        with self.driver.session() as session:
            result = session.run(
                f"""
                MATCH (n:{label})
                WHERE toLower(n.name) CONTAINS toLower($name)
                MATCH (n)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
                RETURN DISTINCT a.name AS allergen
                ORDER BY allergen
                """,
                name=item_name,
            )
            return [r["allergen"] for r in result]

    # ──────────────────────────────────────────────────────────────────────────
    # Phase 6.5 — User Graph
    # ──────────────────────────────────────────────────────────────────────────

    def ensure_auth_user(self, uid: str, email: Optional[str], name: Optional[str]) -> Dict[str, Any]:
        """Upsert User node; initialise counters on first creation."""
        with self.driver.session() as session:
            result = session.run(
                """
                MERGE (u:User {id: $uid})
                ON CREATE SET
                    u.email      = $email,
                    u.name       = $name,
                    u.created_at = datetime(),
                    u.updated_at = datetime()
                ON MATCH SET
                    u.email      = coalesce($email, u.email),
                    u.name       = coalesce($name, u.name),
                    u.updated_at = datetime()
                RETURN
                    u.id    AS id,
                    u.email AS email,
                    u.name  AS name
                """,
                uid=uid,
                email=email,
                name=name,
            )
            record = result.single()
            return dict(record) if record else {"id": uid, "email": email, "name": name}

    # ── Interaction tracking ───────────────────────────────────────────────
    #
    # All interaction methods use a single atomic Cypher query that:
    #   1. MERGEs the User node (upsert)
    #   2. MATCHes the target item by label + toString(id) for type-safe lookup
    #   3. Performs the relationship operation
    #   4. RETURNs the matched item.id so we can verify the operation succeeded
    #
    # If the MATCH finds zero items, the query returns zero rows and
    # result.single() is None — we raise ValueError("item not found").
    #
    # WITH clauses separate destructive (DELETE) and constructive (MERGE)
    # operations for compatibility across Neo4j 4.x and 5.x.

    @staticmethod
    def _label_for_cluster(cluster: str) -> str:
        return "FoodProduct" if cluster == "product" else "Recipe"

    def log_viewed(self, uid: str, item_id: str, cluster: str) -> None:
        """Log / increment a VIEWED relationship (upsert; count increments on repeat)."""
        label = self._label_for_cluster(cluster)
        with self.driver.session() as session:
            result = session.run(
                f"""
                MATCH (item:{label})
                WHERE toString(item.id) = toString($item_id)
                WITH item
                MERGE (u:User {{id: $uid}})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime()
                WITH u, item
                MERGE (u)-[r:VIEWED]->(item)
                ON CREATE SET r.at = datetime(), r.count = 1
                ON MATCH  SET r.at = datetime(), r.count = r.count + 1
                RETURN toString(item.id) AS matched_id
                """,
                uid=uid,
                item_id=str(item_id),
            ).single()
            if result is None:
                raise ValueError(f"{label} item not found: {item_id}")

    def log_liked(self, uid: str, item_id: str, cluster: str) -> None:
        """Log a LIKED relationship; removes DISLIKED if present."""
        label = self._label_for_cluster(cluster)
        with self.driver.session() as session:
            result = session.run(
                f"""
                MATCH (item:{label})
                WHERE toString(item.id) = toString($item_id)
                WITH item
                MERGE (u:User {{id: $uid}})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime()
                WITH u, item
                OPTIONAL MATCH (u)-[dis:DISLIKED]->(item)
                DELETE dis
                WITH u, item
                MERGE (u)-[r:LIKED]->(item)
                ON CREATE SET r.at = datetime()
                ON MATCH  SET r.at = datetime()
                RETURN toString(item.id) AS matched_id
                """,
                uid=uid,
                item_id=str(item_id),
            ).single()
            if result is None:
                raise ValueError(f"{label} item not found: {item_id}")

    def log_unliked(self, uid: str, item_id: str, cluster: str) -> None:
        """Remove a LIKED relationship (toggle off)."""
        label = self._label_for_cluster(cluster)
        with self.driver.session() as session:
            # First verify item exists, then delete the relationship if it exists.
            # We MATCH the item independently so we always get a result row even
            # when there is no LIKED relationship to delete.
            result = session.run(
                f"""
                MATCH (item:{label})
                WHERE toString(item.id) = toString($item_id)
                WITH item
                MERGE (u:User {{id: $uid}})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime()
                WITH u, item
                OPTIONAL MATCH (u)-[r:LIKED]->(item)
                DELETE r
                WITH u, item
                RETURN toString(item.id) AS matched_id
                """,
                uid=uid,
                item_id=str(item_id),
            ).single()
            if result is None:
                raise ValueError(f"{label} item not found: {item_id}")

    def log_disliked(self, uid: str, item_id: str, cluster: str) -> None:
        """Log a DISLIKED relationship; removes LIKED if present."""
        label = self._label_for_cluster(cluster)
        with self.driver.session() as session:
            result = session.run(
                f"""
                MATCH (item:{label})
                WHERE toString(item.id) = toString($item_id)
                WITH item
                MERGE (u:User {{id: $uid}})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime()
                WITH u, item
                OPTIONAL MATCH (u)-[lik:LIKED]->(item)
                DELETE lik
                WITH u, item
                MERGE (u)-[r:DISLIKED]->(item)
                ON CREATE SET r.at = datetime()
                ON MATCH  SET r.at = datetime()
                RETURN toString(item.id) AS matched_id
                """,
                uid=uid,
                item_id=str(item_id),
            ).single()
            if result is None:
                raise ValueError(f"{label} item not found: {item_id}")

    def log_undisliked(self, uid: str, item_id: str, cluster: str) -> None:
        """Remove a DISLIKED relationship (toggle off)."""
        label = self._label_for_cluster(cluster)
        with self.driver.session() as session:
            result = session.run(
                f"""
                MATCH (item:{label})
                WHERE toString(item.id) = toString($item_id)
                WITH item
                MERGE (u:User {{id: $uid}})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime()
                WITH u, item
                OPTIONAL MATCH (u)-[r:DISLIKED]->(item)
                DELETE r
                WITH u, item
                RETURN toString(item.id) AS matched_id
                """,
                uid=uid,
                item_id=str(item_id),
            ).single()
            if result is None:
                raise ValueError(f"{label} item not found: {item_id}")

    def log_cooked(self, uid: str, recipe_id: str, rating: Optional[int] = None) -> None:
        """Log a COOKED relationship with optional rating (1-5)."""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (r:Recipe)
                WHERE toString(r.id) = toString($recipe_id)
                WITH r
                MERGE (u:User {id: $uid})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime()
                WITH u, r
                MERGE (u)-[rel:COOKED]->(r)
                ON CREATE SET rel.at = datetime(), rel.rating = $rating
                ON MATCH  SET rel.at = datetime(),
                              rel.rating = CASE WHEN $rating IS NOT NULL THEN $rating ELSE rel.rating END
                RETURN toString(r.id) AS matched_id
                """,
                uid=uid,
                recipe_id=str(recipe_id),
                rating=rating,
            ).single()
            if result is None:
                raise ValueError(f"Recipe not found: {recipe_id}")

    def log_search_event(
        self,
        uid: str,
        query: str,
        cluster: str,
        result_found: bool,
    ) -> None:
        """
        Create a SearchEvent node linked to the User via PERFORMED.
        Automatically prunes the user's search history to keep only the 50 most recent
        searches, preventing unbounded database growth.
        """
        event_id = str(uuid.uuid4())
        cypher = """
            MERGE (u:User {id: $uid})
            ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
            ON MATCH  SET u.updated_at = datetime()
            CREATE (se:SearchEvent {
                id:           $event_id,
                search_query: $search_query,
                cluster:      $cluster,
                result_found: $result_found,
                timestamp:    datetime()
            })
            CREATE (u)-[:PERFORMED]->(se)
            WITH u
            MATCH (u)-[:PERFORMED]->(old_se:SearchEvent)
            WITH old_se ORDER BY old_se.timestamp DESC SKIP 50
            DETACH DELETE old_se
        """
        with self.driver.session() as session:
            session.run(
                cypher,
                uid=uid,
                event_id=event_id,
                search_query=query,
                cluster=cluster,
                result_found=result_found,
            )

    # ── Allergen profile ───────────────────────────────────────────────────

    def set_allergens(self, uid: str, allergen_names: List[str]) -> None:
        """Replace the user's ALLERGIC_TO set atomically."""
        with self.driver.session() as session:
            session.run(
                """
                MERGE (u:User {id: $uid})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime()
                """,
                uid=uid,
            )
            # Remove existing ALLERGIC_TO edges
            session.run(
                """
                MATCH (u:User {id: $uid})-[r:ALLERGIC_TO]->()
                DELETE r
                """,
                uid=uid,
            )
            if allergen_names:
                session.run(
                    """
                    MATCH (u:User {id: $uid})
                    UNWIND $names AS aname
                    MATCH (a:AllergenTag {name: aname})
                    MERGE (u)-[:ALLERGIC_TO {set_at: datetime()}]->(a)
                    """,
                    uid=uid,
                    names=allergen_names,
                )

    def get_user_preference_states(
        self,
        uid: str,
        recipe_ids: List[str],
        product_ids: List[str],
    ) -> List[Dict[str, str]]:
        """
        Return LIKED/DISLIKED state per requested item.

        Each row has:
          - id
          - cluster ('recipe' | 'product')
          - state ('liked' | 'disliked')
        """
        results: List[Dict[str, str]] = []
        with self.driver.session() as session:
            if recipe_ids:
                recipe_rows = session.run(
                    """
                    MATCH (u:User {id: $uid})-[r:LIKED|DISLIKED]->(item:Recipe)
                    WHERE toString(item.id) IN $item_ids
                    WITH item, type(r) AS rel_type, coalesce(r.at, datetime({epochSeconds: 0})) AS rel_at
                    ORDER BY rel_at DESC
                    WITH item, collect(rel_type)[0] AS rel_type
                    RETURN item.id AS id, 'recipe' AS cluster, rel_type
                    """,
                    uid=uid,
                    item_ids=[str(item_id) for item_id in recipe_ids],
                )
                for row in recipe_rows:
                    rel_type = row.get("rel_type")
                    if rel_type in {"LIKED", "DISLIKED"}:
                        results.append(
                            {
                                "id": str(row["id"]),
                                "cluster": "recipe",
                                "state": "liked" if rel_type == "LIKED" else "disliked",
                            }
                        )

            if product_ids:
                product_rows = session.run(
                    """
                    MATCH (u:User {id: $uid})-[r:LIKED|DISLIKED]->(item:FoodProduct)
                    WHERE toString(item.id) IN $item_ids
                    WITH item, type(r) AS rel_type, coalesce(r.at, datetime({epochSeconds: 0})) AS rel_at
                    ORDER BY rel_at DESC
                    WITH item, collect(rel_type)[0] AS rel_type
                    RETURN item.id AS id, 'product' AS cluster, rel_type
                    """,
                    uid=uid,
                    item_ids=[str(item_id) for item_id in product_ids],
                )
                for row in product_rows:
                    rel_type = row.get("rel_type")
                    if rel_type in {"LIKED", "DISLIKED"}:
                        results.append(
                            {
                                "id": str(row["id"]),
                                "cluster": "product",
                                "state": "liked" if rel_type == "LIKED" else "disliked",
                            }
                        )

        return results

    def get_allergens(self, uid: str) -> List[str]:
        """Return the user's current allergen names."""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (u:User {id: $uid})-[:ALLERGIC_TO]->(a:AllergenTag)
                RETURN a.name AS name ORDER BY name
                """,
                uid=uid,
            )
            return [r["name"] for r in result]

    def get_all_allergen_tags(self) -> List[str]:
        """Return all AllergenTag names available in the graph."""
        with self.driver.session() as session:
            result = session.run(
                "MATCH (a:AllergenTag) RETURN a.name AS name ORDER BY name"
            )
            return [r["name"] for r in result]

    # ── Recommender data queries ───────────────────────────────────────────

    def get_user_interactions(self, uid: str) -> List[Dict[str, Any]]:
        """
        Return all COOKED / LIKED / VIEWED / DISLIKED interactions with their
        embeddings and timestamps — used by the recommender to build a taste profile.

        Items without embeddings are still returned (embedding will be None)
        so the recommender can count positive interactions for cold-start threshold.
        """
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (u:User {id: $uid})-[r:COOKED|LIKED|VIEWED|DISLIKED]->(item)
                RETURN
                    type(r)        AS rel_type,
                    r.at           AS at,
                    r.count        AS view_count,
                    r.rating       AS rating,
                    item.id        AS item_id,
                    item.embedding AS embedding
                """,
                uid=uid,
            )
            return [dict(row) for row in result]

    def get_user_recent_searches(self, uid: str, limit: int = 10) -> List[str]:
        """Return the user's most recent search query strings (newest first)."""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (u:User {id: $uid})-[:PERFORMED]->(se:SearchEvent)
                RETURN se.search_query AS query
                ORDER BY se.timestamp DESC
                LIMIT $limit
                """,
                uid=uid,
                limit=limit,
            )
            return [r["query"] for r in result if r["query"]]

    def set_user_preferences(
        self,
        uid: str,
        cuisines: List[str],
        health_tags: List[str],
        health_goal: Optional[str] = None,
    ) -> None:
        """Store onboarding preferences: PREFERS_CUISINE rels, PREFERS_HEALTH_TAG rels, health_goal."""
        with self.driver.session() as session:
            session.run(
                """
                MERGE (u:User {id: $uid})
                ON CREATE SET u.created_at = datetime(), u.updated_at = datetime()
                ON MATCH  SET u.updated_at = datetime(), u.health_goal = $health_goal
                """,
                uid=uid,
                health_goal=health_goal,
            )
            session.run(
                """
                MATCH (u:User {id: $uid})-[r:PREFERS_CUISINE|PREFERS_HEALTH_TAG]->()
                DELETE r
                """,
                uid=uid,
            )
            if cuisines:
                session.run(
                    """
                    MATCH (u:User {id: $uid})
                    UNWIND $cuisines AS cname
                    MERGE (c:Cuisine {name: cname})
                    MERGE (u)-[:PREFERS_CUISINE {set_at: datetime()}]->(c)
                    """,
                    uid=uid,
                    cuisines=cuisines,
                )
            if health_tags:
                session.run(
                    """
                    MATCH (u:User {id: $uid})
                    UNWIND $tags AS tname
                    MERGE (ht:HealthTag {name: tname})
                    MERGE (u)-[:PREFERS_HEALTH_TAG {set_at: datetime()}]->(ht)
                    """,
                    uid=uid,
                    tags=health_tags,
                )

    def get_allergen_safe_candidates(
        self,
        uid: str,
        cluster: str = "all",
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        """
        Return candidate items for personalized ranking.
        Excludes:
          - items the user already COOKED or DISLIKED
          - items containing allergens the user is ALLERGIC_TO
        Returns id, name, embedding, and key nutrition fields per item.
        """
        with self.driver.session() as session:
            blocked_result = session.run(
                """
                MATCH (u:User {id: $uid})-[:ALLERGIC_TO]->(a:AllergenTag)
                RETURN collect(a.name) AS blocked
                """,
                uid=uid,
            )
            row = blocked_result.single()
            blocked_allergens: List[str] = row["blocked"] if row else []

            results: List[Dict[str, Any]] = []

            if cluster in ("all", "recipe"):
                recipe_result = session.run(
                    """
                    MATCH (u:User {id: $uid})
                    MATCH (r:Recipe)
                    WHERE NOT EXISTS { MATCH (u)-[:COOKED|DISLIKED]->(r) }
                      AND NOT EXISTS {
                          MATCH (r)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
                          WHERE a.name IN $blocked
                      }
                    RETURN
                        r.id             AS id,
                        r.name           AS name,
                        r.food_name      AS food_name,
                        r.serving_size_g AS serving_size_g,
                        r.calories       AS calories,
                        r.protein        AS protein,
                        r.carbohydrates  AS carbohydrates,
                        r.fats           AS fats,
                        r.fibre          AS fibre,
                        r.prep_time_mins AS prep_time_mins,
                        r.embedding      AS embedding,
                        'recipe'         AS cluster
                    LIMIT $limit
                    """,
                    uid=uid,
                    blocked=blocked_allergens,
                    limit=limit,
                )
                results.extend([dict(r) for r in recipe_result])

            if cluster in ("all", "product"):
                product_result = session.run(
                    """
                    MATCH (u:User {id: $uid})
                    MATCH (fp:FoodProduct)
                    WHERE NOT EXISTS { MATCH (u)-[:DISLIKED]->(fp) }
                      AND NOT EXISTS {
                          MATCH (fp)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
                          WHERE a.name IN $blocked
                      }
                    OPTIONAL MATCH (fp)-[:MADE_BY]->(b:Brand)
                    OPTIONAL MATCH (fp)-[:IN_CATEGORY]->(cat:Category)
                    RETURN
                        fp.id               AS id,
                        fp.name             AS name,
                        fp.calories_100g    AS calories,
                        fp.proteins_100g    AS protein,
                        fp.carbohydrates_100g AS carbohydrates,
                        fp.fat_100g         AS fats,
                        fp.fiber_100g       AS fibre,
                        b.name              AS brand,
                        cat.name            AS category,
                        fp.embedding        AS embedding,
                        'product'           AS cluster
                    LIMIT $limit
                    """,
                    uid=uid,
                    blocked=blocked_allergens,
                    limit=limit,
                )
                results.extend([dict(r) for r in product_result])

        return results

    def get_popular_items(
        self,
        uid: Optional[str] = None,
        cluster: str = "all",
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Cold-start fallback: globally popular items ordered by collective LIKED + COOKED
        counts, filtered by the requesting user's allergens (if uid is provided).

        Uses subquery count expressions (Neo4j 5.x).
        """
        # Fetch this user's blocked allergens so cold-start is still safe
        blocked_allergens: List[str] = []
        if uid:
            with self.driver.session() as session:
                row = session.run(
                    """
                    MATCH (u:User {id: $uid})-[:ALLERGIC_TO]->(a:AllergenTag)
                    RETURN collect(a.name) AS blocked
                    """,
                    uid=uid,
                ).single()
                if row:
                    blocked_allergens = row["blocked"]

        results: List[Dict[str, Any]] = []
        with self.driver.session() as session:
            if cluster in ("all", "recipe"):
                recipe_result = session.run(
                    """
                    MATCH (r:Recipe)
                    WHERE NOT EXISTS {
                          MATCH (r)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
                          WHERE a.name IN $blocked
                      }
                    WITH r,
                         count { (:User)-[:LIKED]->(r) }  AS like_count,
                         count { (:User)-[:COOKED]->(r) } AS cook_count
                    RETURN
                        r.id             AS id,
                        r.name           AS name,
                        r.food_name      AS food_name,
                        r.serving_size_g AS serving_size_g,
                        r.calories       AS calories,
                        r.protein        AS protein,
                        r.carbohydrates  AS carbohydrates,
                        r.fats           AS fats,
                        r.fibre          AS fibre,
                        r.prep_time_mins AS prep_time_mins,
                        r.embedding      AS embedding,
                        'recipe'         AS cluster,
                        like_count + cook_count * 2 AS popularity
                    ORDER BY popularity DESC, rand()
                    LIMIT $limit
                    """,
                    blocked=blocked_allergens,
                    limit=limit,
                )
                results.extend([dict(r) for r in recipe_result])

            if cluster in ("all", "product"):
                product_result = session.run(
                    """
                    MATCH (fp:FoodProduct)
                    WHERE NOT EXISTS {
                          MATCH (fp)-[:CONTAINS]->(i:Ingredient)-[:IS_ALLERGEN]->(a:AllergenTag)
                          WHERE a.name IN $blocked
                      }
                    OPTIONAL MATCH (fp)-[:MADE_BY]->(b:Brand)
                    OPTIONAL MATCH (fp)-[:IN_CATEGORY]->(cat:Category)
                    WITH fp, b, cat,
                         count { (:User)-[:LIKED]->(fp) } AS like_count
                    RETURN
                        fp.id               AS id,
                        fp.name             AS name,
                        fp.calories_100g    AS calories,
                        fp.proteins_100g    AS protein,
                        fp.carbohydrates_100g AS carbohydrates,
                        fp.fat_100g         AS fats,
                        fp.fiber_100g       AS fibre,
                        b.name              AS brand,
                        cat.name            AS category,
                        fp.embedding        AS embedding,
                        'product'           AS cluster,
                        like_count          AS popularity
                    ORDER BY popularity DESC, rand()
                    LIMIT $limit
                    """,
                    blocked=blocked_allergens,
                    limit=limit,
                )
                results.extend([dict(r) for r in product_result])

        return results

    # ── Profile & history ─────────────────────────────────────────────────

    def get_user_profile(self, uid: str) -> Dict[str, Any]:
        """Return profile stats and last-10 searches for the profile page."""
        with self.driver.session() as session:
            # Core stats
            stats_result = session.run(
                """
                MATCH (u:User {id: $uid})
                OPTIONAL MATCH (u)-[:ALLERGIC_TO]->(a:AllergenTag)
                WITH u, collect(a.name) AS allergens,
                     count { (u)-[:PERFORMED]->(:SearchEvent) } AS total_searches,
                     count { (u)-[:COOKED]->(:Recipe) }         AS total_cooked,
                     count { (u)-[:LIKED]->() }                 AS total_liked,
                     count { (u)-[:VIEWED]->() }                AS total_viewed
                RETURN
                    u.id         AS id,
                    u.email      AS email,
                    u.name       AS name,
                    u.created_at AS created_at,
                    allergens,
                    total_searches,
                    total_cooked,
                    total_liked,
                    total_viewed
                """,
                uid=uid,
            )
            profile_row = stats_result.single()
            if not profile_row:
                return {}
            profile = dict(profile_row)

            # Recent searches (last 10)
            search_result = session.run(
                """
                MATCH (u:User {id: $uid})-[:PERFORMED]->(se:SearchEvent)
                RETURN se.search_query AS query, se.cluster AS cluster,
                       se.result_found AS result_found, se.timestamp AS timestamp
                ORDER BY se.timestamp DESC
                LIMIT 10
                """,
                uid=uid,
            )
            profile["recent_searches"] = [dict(r) for r in search_result]

            # Recently viewed (last 5, with names)
            viewed_result = session.run(
                """
                MATCH (u:User {id: $uid})-[vr:VIEWED]->(item)
                WHERE item:Recipe OR item:FoodProduct
                RETURN item.id AS id, item.name AS name,
                       CASE WHEN item:Recipe THEN 'recipe' ELSE 'product' END AS cluster,
                       vr.at AS viewed_at
                ORDER BY vr.at DESC
                LIMIT 5
                """,
                uid=uid,
            )
            profile["recent_viewed"] = [dict(r) for r in viewed_result]

        return profile

    def get_user_cooked(self, uid: str, limit: int = 8) -> List[Dict[str, Any]]:
        """Return recently cooked recipes (most recent first) for the profile page."""
        with self.driver.session() as session:
            result = session.run(
                """
                MATCH (u:User {id: $uid})-[rel:COOKED]->(r:Recipe)
                RETURN
                    r.id             AS id,
                    r.name           AS name,
                    r.food_name      AS food_name,
                    r.serving_size_g AS serving_size_g,
                    r.calories       AS calories,
                    r.protein        AS protein,
                    r.carbohydrates  AS carbohydrates,
                    r.fats           AS fats,
                    r.fibre          AS fibre,
                    r.prep_time_mins AS prep_time_mins,
                    rel.at           AS cooked_at,
                    rel.rating       AS rating,
                    'recipe'         AS cluster
                ORDER BY rel.at DESC
                LIMIT $limit
                """,
                uid=uid,
                limit=limit,
            )
            return [dict(r) for r in result]

    # ── GDPR ──────────────────────────────────────────────────────────────

    def export_user_data(self, uid: str) -> Dict[str, Any]:
        """Return all user data for GDPR Article 20 data portability."""
        with self.driver.session() as session:
            # Profile
            profile_result = session.run(
                """
                MATCH (u:User {id: $uid})
                RETURN u.id AS id, u.email AS email, u.name AS name,
                       u.created_at AS created_at, u.updated_at AS updated_at
                """,
                uid=uid,
            )
            profile_row = profile_result.single()
            profile = dict(profile_row) if profile_row else {}

            # Allergens
            allergen_result = session.run(
                "MATCH (u:User {id: $uid})-[:ALLERGIC_TO]->(a:AllergenTag) RETURN a.name AS name",
                uid=uid,
            )
            profile["allergens"] = [r["name"] for r in allergen_result]

            # Search history
            search_result = session.run(
                """
                MATCH (u:User {id: $uid})-[:PERFORMED]->(se:SearchEvent)
                RETURN se.id AS id, se.search_query AS query, se.cluster AS cluster,
                       se.result_found AS result_found, se.timestamp AS timestamp
                ORDER BY se.timestamp DESC
                """,
                uid=uid,
            )
            profile["search_history"] = [dict(r) for r in search_result]

            # Interactions
            interactions_result = session.run(
                """
                MATCH (u:User {id: $uid})-[r:LIKED|DISLIKED|COOKED|VIEWED]->(item)
                RETURN type(r) AS interaction, item.id AS item_id, item.name AS item_name,
                       CASE WHEN item:Recipe THEN 'recipe' ELSE 'product' END AS cluster,
                       r.at AS at
                ORDER BY r.at DESC
                """,
                uid=uid,
            )
            profile["interactions"] = [dict(r) for r in interactions_result]

        return profile

    def delete_user(self, uid: str) -> None:
        """
        GDPR Right to be Forgotten — delete the user node and all associated data.
        SearchEvent nodes are fully deleted (not just unlinked) since they are
        user-owned private data.
        """
        with self.driver.session() as session:
            # Delete owned SearchEvent nodes first
            session.run(
                """
                MATCH (u:User {id: $uid})-[:PERFORMED]->(se:SearchEvent)
                DETACH DELETE se
                """,
                uid=uid,
            )
            # Delete the user (DETACH removes all remaining relationships)
            session.run(
                """
                MATCH (u:User {id: $uid})
                DETACH DELETE u
                """,
                uid=uid,
            )
