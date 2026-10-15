import base64
import csv
import logging
import os
import pathlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from Backend.dependencies.auth_user import _decode_access_token

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Report"])

ADMIN_TOKEN = os.getenv("REPORT_ADMIN_TOKEN", "")

_REPORT_DIR = pathlib.Path(os.getenv("REPORT_DIR", "data/reports"))
_REPORT_FILE = _REPORT_DIR / "issue_reports.csv"
_CSV_HEADERS = ["id", "timestamp", "user_email", "query", "response_type", "description", "image_b64"]

_IMAGE_LIMIT = 2 * 1024 * 1024  # 2 MB


def _ensure_csv() -> None:
    _REPORT_DIR.mkdir(parents=True, exist_ok=True)
    if not _REPORT_FILE.exists():
        with open(_REPORT_FILE, "w", newline="", encoding="utf-8") as f:
            csv.writer(f).writerow(_CSV_HEADERS)


def _append_row(row: list[str]) -> None:
    _ensure_csv()
    with open(_REPORT_FILE, "a", newline="", encoding="utf-8") as f:
        csv.writer(f).writerow(row)


def _user_email_from_header(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        payload = _decode_access_token(authorization[7:])
        if payload:
            return payload.get("email", "") or payload.get("sub", "")
    return ""


class ReportRequest(BaseModel):
    description: str
    query: str | None = None
    response_type: str | None = None


@router.post("/report", status_code=201)
async def submit_report(
    body: ReportRequest,
    authorization: str | None = Header(default=None),
):
    user_email = _user_email_from_header(authorization)
    try:
        _append_row([
            str(uuid.uuid4()),
            datetime.now(timezone.utc).isoformat(),
            user_email,
            (body.query or "")[:500],
            (body.response_type or ""),
            body.description[:2000],
            "",
        ])
    except Exception as exc:
        logger.error("Failed to save report: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save report. Please try again.") from exc
    logger.info("Report saved — user=%s type=%s", user_email or "anon", body.response_type)
    return {"status": "received"}


@router.post("/report/feedback", status_code=201)
async def submit_feedback_report(
    description: str = Form(...),
    query: str = Form(default=""),
    response_type: str = Form(default="settings"),
    image: UploadFile | None = File(default=None),
    authorization: str | None = Header(default=None),
):
    user_email = _user_email_from_header(authorization)

    image_b64 = ""
    if image and image.filename:
        content = await image.read(_IMAGE_LIMIT + 1)
        if len(content) > _IMAGE_LIMIT:
            raise HTTPException(status_code=413, detail="Image must be under 2 MB.")
        image_b64 = base64.b64encode(content).decode()

    try:
        _append_row([
            str(uuid.uuid4()),
            datetime.now(timezone.utc).isoformat(),
            user_email,
            query[:500],
            response_type,
            description[:2000],
            image_b64,
        ])
    except Exception as exc:
        logger.error("Failed to save feedback report: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save report. Please try again.") from exc
    logger.info("Feedback report saved — user=%s has_image=%s", user_email or "anon", bool(image_b64))
    return {"status": "received"}


@router.get("/report/download")
async def download_reports(token: str = ""):
    if not ADMIN_TOKEN or token != ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Forbidden.")
    _ensure_csv()
    return FileResponse(
        path=str(_REPORT_FILE),
        media_type="text/csv",
        filename="nutriverse_reports.csv",
    )
