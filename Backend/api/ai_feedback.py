import csv
import logging
import os
import pathlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from Backend.dependencies.auth_user import _decode_access_token

logger = logging.getLogger(__name__)
router = APIRouter(tags=["AI Feedback"])

_FEEDBACK_DIR = pathlib.Path(os.getenv("REPORT_DIR", "data/reports"))
_FEEDBACK_FILE = _FEEDBACK_DIR / "ai_response_feedback.csv"
_CSV_HEADERS = ["id", "timestamp", "user_email", "context", "ai_response", "user_comment"]

ADMIN_TOKEN = os.getenv("REPORT_ADMIN_TOKEN", "")


def _ensure_csv():
    _FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    if not _FEEDBACK_FILE.exists():
        with open(_FEEDBACK_FILE, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(_CSV_HEADERS)


class AiFeedbackRequest(BaseModel):
    ai_response: str
    user_comment: str
    context: str | None = None


@router.post("/ai-feedback", status_code=201)
async def submit_ai_feedback(
    body: AiFeedbackRequest,
    authorization: str | None = Header(default=None),
):
    user_email = ""
    if authorization and authorization.lower().startswith("bearer "):
        payload = _decode_access_token(authorization[7:])
        if payload:
            user_email = payload.get("email", "") or payload.get("sub", "")

    _ensure_csv()
    row = [
        str(uuid.uuid4()),
        datetime.now(timezone.utc).isoformat(),
        user_email,
        (body.context or ""),
        body.ai_response[:3000],
        body.user_comment[:2000],
    ]
    with open(_FEEDBACK_FILE, "a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(row)

    logger.info("AI feedback saved — user=%s context=%s", user_email or "anon", body.context)
    return {"status": "received"}


@router.get("/ai-feedback/download")
async def download_feedback(token: str = ""):
    if not ADMIN_TOKEN or token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Forbidden.")
    _ensure_csv()
    return FileResponse(
        path=str(_FEEDBACK_FILE),
        media_type="text/csv",
        filename="nutriverse_ai_feedback.csv",
    )
