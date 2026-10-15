"""
Phase 3 — GraphRAG: Generate and store vector embeddings in Neo4j.

This script:
1. Loads the `all-MiniLM-L6-v2` sentence-transformer model (384-dim).
2. Fetches ALL Recipe nodes and generates embeddings from a text
   concatenation of name + food_name + ingredients + cuisine.
3. Fetches ALL FoodProduct nodes and generates embeddings from
   name + brand + category + generic_name.
4. Stores each embedding as an `embedding` property (list[float]) on the node.
5. Creates (or replaces) Neo4j vector indexes on both node types so that
   `db.index.vector.queryNodes(...)` works for semantic search.

Usage:
    python scripts/generate_embeddings.py [--batch-size 64] [--dry-run]

Prerequisites:
    pip install sentence-transformers
    Neo4j running with both Recipe and FoodProduct nodes populated.
"""

import argparse
import logging
import os
import sys
import time
from typing import List, Dict, Any

from dotenv import load_dotenv
from neo4j import GraphDatabase
from sentence_transformers import SentenceTransformer

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

# ── constants ─────────────────────────────────────────────────────────────────
MODEL_NAME = "all-MiniLM-L6-v2"   # 384-dimensional, ~80 MB, fully offline
VECTOR_DIMS = 384
SIMILARITY_FN = "cosine"

RECIPE_INDEX_NAME = "recipe_embedding"
PRODUCT_INDEX_NAME = "product_embedding"


# ── helpers ───────────────────────────────────────────────────────────────────

def _safe(v) -> str:
    """Convert a potentially None value to an empty string."""
    return str(v).strip() if v is not None else ""


def recipe_text(r: Dict[str, Any]) -> str:
    """Build a single text string from a Recipe record for embedding."""
    parts = [
        _safe(r.get("name")),
        _safe(r.get("food_name")),
        _safe(r.get("raw_ingredients")),
    ]
    return " | ".join(p for p in parts if p)


def product_text(p: Dict[str, Any]) -> str:
    """Build a single text string from a FoodProduct record for embedding."""
    parts = [
        _safe(p.get("name")),
        _safe(p.get("generic_name")),
        _safe(p.get("brand")),
        _safe(p.get("category")),
    ]
    return " | ".join(p for p in parts if p)


def batched(lst: list, size: int):
    """Yield successive *size*-element chunks from *lst*."""
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


# ── Neo4j helpers ─────────────────────────────────────────────────────────────

def create_vector_index(session, index_name: str, label: str, property_name: str = "embedding"):
    """
    Create a vector index (idempotent). Drops the old one first if it already
    exists so we can safely re-run with a new model / dimension change.
    """
    # Check if index exists
    existing = session.run(
        "SHOW INDEXES WHERE name = $name", name=index_name
    ).single()

    if existing:
        logger.info("Dropping existing index '%s' before recreation.", index_name)
        session.run(f"DROP INDEX `{index_name}`")

    session.run(
        f"""
        CREATE VECTOR INDEX `{index_name}`
        FOR (n:{label}) ON (n.{property_name})
        OPTIONS {{
            indexConfig: {{
                `vector.dimensions`: {VECTOR_DIMS},
                `vector.similarity_function`: '{SIMILARITY_FN}'
            }}
        }}
        """
    )
    logger.info("Vector index '%s' created on (:%s).%s.", index_name, label, property_name)


def write_embeddings_to_neo4j(
    session,
    node_label: str,
    id_field: str,
    records: List[Dict[str, Any]],
    embeddings: List[List[float]],
    batch_size: int,
    dry_run: bool,
):
    """Batch-write embeddings back onto nodes using UNWIND + MATCH + SET."""
    pairs = [
        {"id": r[id_field], "embedding": emb}
        for r, emb in zip(records, embeddings)
    ]

    total = len(pairs)
    written = 0
    for chunk in batched(pairs, batch_size):
        if dry_run:
            written += len(chunk)
            continue
        session.run(
            f"""
            UNWIND $rows AS row
            MATCH (n:{node_label} {{{id_field}: row.id}})
            SET n.embedding = row.embedding
            """,
            rows=chunk,
        )
        written += len(chunk)
        logger.info("  Written %d / %d embeddings for :%s", written, total, node_label)


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate Neo4j vector embeddings (Phase 3)")
    parser.add_argument("--batch-size", type=int, default=64, help="Embedding batch size (default 64)")
    parser.add_argument("--dry-run", action="store_true", help="Skip Neo4j writes; just validate")
    args = parser.parse_args()

    uri = os.getenv("NEO4J_URI")
    user = os.getenv("NEO4J_USER")
    password = os.getenv("NEO4J_PASSWORD")

    if not all([uri, user, password]):
        logger.error("Missing NEO4J_URI / NEO4J_USER / NEO4J_PASSWORD in environment.")
        sys.exit(1)

    # ── 1. Load embedding model ────────────────────────────────────────────
    logger.info("Loading sentence-transformer model: %s", MODEL_NAME)
    t0 = time.time()
    model = SentenceTransformer(MODEL_NAME)
    logger.info("Model loaded in %.1fs", time.time() - t0)

    driver = GraphDatabase.driver(uri, auth=(user, password))
    driver.verify_connectivity()
    logger.info("Connected to Neo4j at %s", uri)

    with driver.session() as session:

        # ── 2. Create / replace vector indexes ────────────────────────────
        if not args.dry_run:
            create_vector_index(session, RECIPE_INDEX_NAME, "Recipe")
            create_vector_index(session, PRODUCT_INDEX_NAME, "FoodProduct")
        else:
            logger.info("[dry-run] Skipping index creation.")

        # ── 3. Fetch Recipe nodes ─────────────────────────────────────────
        logger.info("Fetching Recipe nodes from Neo4j…")
        recipe_records = [
            dict(r)
            for r in session.run(
                """
                MATCH (r:Recipe)
                RETURN r.id AS id, r.name AS name, r.food_name AS food_name,
                       r.raw_ingredients AS raw_ingredients
                """
            )
        ]
        logger.info("Found %d Recipe nodes.", len(recipe_records))

        # ── 4. Generate Recipe embeddings ─────────────────────────────────
        recipe_texts = [recipe_text(r) for r in recipe_records]
        logger.info("Encoding Recipe embeddings (batch_size=%d)…", args.batch_size)
        t0 = time.time()
        recipe_embeddings = model.encode(
            recipe_texts,
            batch_size=args.batch_size,
            show_progress_bar=True,
            convert_to_numpy=True,
        )
        logger.info("Recipe encoding done in %.1fs", time.time() - t0)

        # ── 5. Write Recipe embeddings ────────────────────────────────────
        logger.info("Writing Recipe embeddings to Neo4j…")
        write_embeddings_to_neo4j(
            session,
            node_label="Recipe",
            id_field="id",
            records=recipe_records,
            embeddings=[e.tolist() for e in recipe_embeddings],
            batch_size=args.batch_size,
            dry_run=args.dry_run,
        )

        # ── 6. Fetch FoodProduct nodes ────────────────────────────────────
        logger.info("Fetching FoodProduct nodes from Neo4j…")
        product_records = [
            dict(r)
            for r in session.run(
                """
                MATCH (fp:FoodProduct)
                OPTIONAL MATCH (fp)-[:MADE_BY]->(b:Brand)
                OPTIONAL MATCH (fp)-[:IN_CATEGORY]->(cat:Category)
                RETURN fp.id AS id, fp.name AS name, fp.generic_name AS generic_name,
                       fp.brand AS brand, cat.name AS category
                """
            )
        ]
        logger.info("Found %d FoodProduct nodes.", len(product_records))

        # ── 7. Generate FoodProduct embeddings ────────────────────────────
        product_texts = [product_text(p) for p in product_records]
        logger.info("Encoding FoodProduct embeddings (batch_size=%d)…", args.batch_size)
        t0 = time.time()
        product_embeddings = model.encode(
            product_texts,
            batch_size=args.batch_size,
            show_progress_bar=True,
            convert_to_numpy=True,
        )
        logger.info("FoodProduct encoding done in %.1fs", time.time() - t0)

        # ── 8. Write FoodProduct embeddings ──────────────────────────────
        logger.info("Writing FoodProduct embeddings to Neo4j…")
        write_embeddings_to_neo4j(
            session,
            node_label="FoodProduct",
            id_field="id",
            records=product_records,
            embeddings=[e.tolist() for e in product_embeddings],
            batch_size=args.batch_size,
            dry_run=args.dry_run,
        )

    driver.close()

    total = len(recipe_records) + len(product_records)
    status = "[dry-run] Would have written" if args.dry_run else "Wrote"
    logger.info("%s embeddings for %d nodes (%d recipes + %d products). Done.",
                status, total, len(recipe_records), len(product_records))


if __name__ == "__main__":
    main()
