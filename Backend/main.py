import logging
import os

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from Backend.api import chat as chat_api
from Backend.api import auth as auth_api
from Backend.api import chef as chef_api
from Backend.api import health as health_api
from Backend.api import process as process_api
from Backend.api import search as search_api
from Backend.api import users as users_api
from Backend.api import voice_stream as voice_stream_api
from Backend.api import kitchen as kitchen_api
from Backend.api import report as report_api
from Backend.api import ai_feedback as ai_feedback_api
from Backend.core.config import settings
from Backend.core.lifespan import lifespan
from Backend.dependencies.auth_user import _decode_access_token
from Backend.dependencies.rate_limiter import current_user_uid

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

# App
app = FastAPI(
    title="NutriVerse",
    description="AI nutrition intelligence for Indian cuisine.",
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── Security headers middleware ───────────────────────────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), geolocation=(), payment=()"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = (
                "max-age=63072000; includeSubDomains; preload"
            )
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ── CORS middleware ──────────────────────────────────────────────────
# Production: set ALLOWED_ORIGINS=app://.,http://localhost:5173 in .env
# Default allows localhost dev only; use "*" explicitly to open up.
_DEFAULT_ORIGINS = "http://localhost:5173,http://localhost:8000,app://."
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate-limit context middleware ─────────────────────────────────────
# Extracts the user UID from the Bearer token (if present) and sets it
# in a context variable so the LLM rate limiter can enforce per-user limits.
@app.middleware("http")
async def set_user_context(request: Request, call_next):
    uid = None
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
        payload = _decode_access_token(token)
        if payload:
            uid = payload.get("sub")
    tok = current_user_uid.set(uid)
    try:
        response = await call_next(request)
    finally:
        current_user_uid.reset(tok)
    return response


# Routers
app.include_router(process_api.router)
app.include_router(health_api.router)
app.include_router(search_api.router)
app.include_router(chat_api.router)
app.include_router(auth_api.router)
app.include_router(users_api.router)
app.include_router(chef_api.router)
app.include_router(voice_stream_api.router)
app.include_router(kitchen_api.router)
app.include_router(report_api.router)
app.include_router(ai_feedback_api.router)


# Exception handlers
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s: %s", request.url, exc)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error."},
    )


# Static files & SPA fallback
# Set SERVE_STATIC=false to disable when using Nginx or CDN in production.
if settings.serve_static and os.path.isdir(settings.frontend_dir):
    _index_html = os.path.join(settings.frontend_dir, "index.html")
    _assets_dir = os.path.join(settings.frontend_dir, "assets")

    # Serve hashed JS/CSS bundles from /assets
    if os.path.isdir(_assets_dir):
        app.mount(
            "/assets",
            StaticFiles(directory=_assets_dir),
            name="frontend-assets",
        )

    # SPA catch-all: any GET that didn't match an API endpoint or /assets
    # is either a root-level static file (vite.svg, favicon.ico …) or a
    # React Router client-side route (e.g. /chef-remote, /search).
    @app.api_route("/{full_path:path}", methods=["GET"], include_in_schema=False)
    async def spa_fallback(request: Request, full_path: str):  # noqa: ARG001
        # First check if it's a real file in the build dir (e.g. /vite.svg)
        candidate = os.path.join(settings.frontend_dir, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        # Otherwise serve index.html for client-side routing
        if os.path.isfile(_index_html):
            return FileResponse(_index_html, media_type="text/html")
        return JSONResponse(status_code=404, content={"error": "Frontend not built."})

    logger.info("Serving SPA from '%s' with catch-all fallback", settings.frontend_dir)
else:
    logger.info(
        "Static file serving disabled (SERVE_STATIC=false or dir not found)."
    )

# Entry point
if __name__ == "__main__":
    import pathlib
    import sys
    # Add project root to sys.path so Backend package is resolvable
    # when this file is run directly (python Backend/main.py).
    sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
    uvicorn.run(
        "Backend.main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
