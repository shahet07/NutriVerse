"""
Phase 3 — GraphRAG semantic search endpoint.

GET /search
    ?q=<query>
    &cluster=all|recipe|product          (default: all)
    &health_tags=High+Protein&health_tags=Low+Calorie   (repeatable)
    &exclude_allergens=Dairy&exclude_allergens=Gluten    (repeatable)
    &limit=10                             (default: 10, max: 50)
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from Backend.dependencies.auth_user import get_optional_user
from Backend.dependencies.graph_rag import get_graph_rag_service
from Backend.dependencies.neo4j import get_neo4j_client
from Backend.schemas.search import SearchResponse, SearchResult

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Search"])


@router.get("/search", response_model=SearchResponse)
async def semantic_search(
    background_tasks: BackgroundTasks,
    q: str = Query(..., min_length=1, description="Natural language search query"),
    cluster: str = Query(
        "all",
        description="Which food cluster to search: 'all', 'recipe', or 'product'",
    ),
    health_tags: Optional[List[str]] = Query(
        None,
        description="Filter to nodes tagged SUITABLE_FOR all of these health tags. "
                    "E.g. health_tags=High+Protein&health_tags=Low+Calorie",
    ),
    exclude_allergens: Optional[List[str]] = Query(
        None,
        description="Exclude nodes containing any of these allergens. "
                    "E.g. exclude_allergens=Dairy&exclude_allergens=Gluten",
    ),
    limit: int = Query(10, ge=1, le=50, description="Max results (1–50)"),
    rag_service=Depends(get_graph_rag_service),
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
    neo4j_client=Depends(get_neo4j_client),
):
    """
    Hybrid semantic search across the food knowledge graph.

    Returns results from both the **Recipe** cluster (home-cooked Indian dishes)
    and/or the **FoodProduct** cluster (packaged products), re-ranked by a
    combination of vector similarity and graph constraint match scores.

    - If vector indexes have been built (`scripts/generate_embeddings.py`),
      uses `all-MiniLM-L6-v2` embeddings for semantic matching.
    - Falls back to Neo4j full-text search if vector indexes are not available.
    - `health_tags` filtering uses `SUITABLE_FOR` graph edges built by
      `scripts/tag_health_nodes.py`.
    - `exclude_allergens` filtering uses `IS_ALLERGEN` edges in the graph.
    """
    if cluster not in {"all", "recipe", "product"}:
        raise HTTPException(
            status_code=400,
            detail="'cluster' must be one of: all, recipe, product",
        )

    try:
        raw_results = await rag_service.search_async(
            query=q.strip(),
            cluster=cluster,
            limit=limit,
            health_tags=health_tags or [],
            exclude_allergens=exclude_allergens or [],
        )
    except Exception as exc:
        logger.exception("GraphRAG search failed: %s", exc)
        raise HTTPException(status_code=500, detail="Search failed. Please try again.")

    # Filter out any records missing required fields before Pydantic validation
    valid_raw = [
        r for r in raw_results
        if r.get("id") is not None and r.get("name") is not None
    ]

    results = []
    for r in valid_raw:
        try:
            results.append(SearchResult(**r))
        except Exception as exc:
            logger.warning("Skipping malformed search result: %s — %s", r.get("name"), exc)

    # Attach persisted like/dislike state for authenticated users so the
    # frontend can render prior reactions on revisit/search.
    if current_user and results:
        uid = current_user["uid"]
        recipe_ids = [r.id for r in results if r.cluster == "recipe"]
        product_ids = [r.id for r in results if r.cluster == "product"]
        try:
            states = await asyncio.to_thread(
                neo4j_client.get_user_preference_states,
                uid,
                recipe_ids,
                product_ids,
            )
            state_map = {
                (s["cluster"], str(s["id"])): s["state"]
                for s in states
                if s.get("state") in {"liked", "disliked"}
            }
            for r in results:
                r.interaction_state = state_map.get((r.cluster, str(r.id)))
        except Exception as exc:
            logger.warning("Failed to hydrate interaction states for uid=%s: %s", uid, exc)

    # Surface available health tags for the UI
    try:
        available_tags = rag_service.get_all_health_tags()
    except Exception:
        available_tags = []

    # Passive interaction logging for authenticated users (fire-and-forget)
    if current_user:
        uid = current_user["uid"]
        background_tasks.add_task(
            neo4j_client.log_search_event,
            uid=uid,
            query=q.strip(),
            cluster=cluster,
            result_found=len(results) > 0,
        )
        if results:
            top = results[0]
            background_tasks.add_task(
                neo4j_client.log_viewed,
                uid=uid,
                item_id=top.id,
                cluster=top.cluster,
            )

    return SearchResponse(
        query=q.strip(),
        cluster_filter=cluster,
        health_tags=health_tags or [],
        excluded_allergens=exclude_allergens or [],
        total=len(results),
        results=results,
        vector_search_used=rag_service._check_vector_ready(),
        health_tags_available=available_tags,
    )
