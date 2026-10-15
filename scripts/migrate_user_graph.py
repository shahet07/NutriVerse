"""
Phase 6.5 — User Graph constraints and indexes.

Idempotent — safe to run multiple times (uses IF NOT EXISTS).
Adds:
  - Unique constraint on SearchEvent.id
  - Composite index on SearchEvent.timestamp (for time-range history queries)
  - Full-text index on SearchEvent.query (for search history search)
"""
from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv(pathlib.Path(__file__).resolve().parents[1] / ".env")

from Src.neo4j_client import Neo4jClient  # noqa: E402


STEPS = [
    (
        "Unique constraint — SearchEvent.id",
        """
        CREATE CONSTRAINT search_event_id IF NOT EXISTS
        FOR (se:SearchEvent) REQUIRE se.id IS UNIQUE
        """,
    ),
    (
        "Index — SearchEvent.timestamp",
        """
        CREATE INDEX search_event_timestamp IF NOT EXISTS
        FOR (se:SearchEvent) ON (se.timestamp)
        """,
    ),
]

FULLTEXT_STEP = (
    "Full-text index — SearchEvent.search_query",
    """
    CREATE FULLTEXT INDEX search_event_query IF NOT EXISTS
    FOR (se:SearchEvent) ON EACH [se.search_query]
    """,
)


def run() -> None:
    print("Connecting to Neo4j…")
    client = Neo4jClient()

    with client.driver.session() as session:
        for label, cypher in STEPS:
            print(f"  Applying: {label}")
            session.run(cypher)

        label, cypher = FULLTEXT_STEP
        print(f"  Applying: {label}")
        try:
            session.run(cypher)
        except Exception as exc:
            # Full-text index creation raises if already present on some Neo4j versions
            print(f"    Skipped (already exists or unsupported): {exc}")

    print("\nUser graph migration complete.\n")
    client.close()


if __name__ == "__main__":
    run()
