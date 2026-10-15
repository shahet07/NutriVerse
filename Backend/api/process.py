import logging
import os
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile

from Backend.core.config import settings
from Backend.dependencies.auth_user import get_optional_user
from Backend.dependencies.neo4j import get_neo4j_client
from Backend.dependencies.router import get_router
logger = logging.getLogger(__name__)
router = APIRouter(tags=["Process"])


def _validate_extension(filename: str) -> bool:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in settings.allowed_extensions


@router.post("/process")
async def process(
    background_tasks: BackgroundTasks,
    query: Optional[str] = Form(None),
    nsq: Optional[str] = Query(None),
    image: Optional[UploadFile] = File(None),
    nutri_router=Depends(get_router),
    current_user: Optional[Dict[str, Any]] = Depends(get_optional_user),
    neo4j_client=Depends(get_neo4j_client),
):
    query = query or nsq
    has_query = query and query.strip()
    has_image = image is not None and image.filename

    if not has_query and not has_image:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of: 'query' (text) or 'image' (file).",
        )

    image_path: Optional[str] = None

    try:
        if has_image:
            if not _validate_extension(image.filename):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Unsupported file type. "
                        f"Allowed: {', '.join(sorted(settings.allowed_extensions))}"
                    ),
                )

            contents = await image.read()

            if len(contents) > settings.max_content_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"File exceeds {settings.max_content_mb} MB limit.",
                )

            safe_name = f"{uuid.uuid4().hex}_{os.path.basename(image.filename)}"
            image_path = os.path.join(settings.upload_dir, safe_name)

            with open(image_path, "wb") as f:
                f.write(contents)

        result = await nutri_router.execute_async(
            text_query=query or "",
            image_input=image_path,
        )

        # Passive SearchEvent logging for authenticated users
        if current_user and query and query.strip():
            uid = current_user["uid"]
            result_found = (
                result.get("status") not in ("NOT_FOUND", "ERROR")
                if isinstance(result, dict)
                else True
            )
            background_tasks.add_task(
                neo4j_client.log_search_event,
                uid=uid,
                query=query.strip(),
                cluster="recipe",
                result_found=result_found,
            )

        return result

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Unhandled error in /process: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error.")

    finally:
        if image_path and os.path.exists(image_path):
            try:
                os.remove(image_path)
            except OSError as exc:
                logger.warning("Could not delete temp file %s: %s", image_path, exc)
