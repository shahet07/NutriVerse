import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Settings:
    serve_static: bool = field(
        default_factory=lambda: os.getenv("SERVE_STATIC", "true").lower() == "true"
    )
    upload_dir: str = field(
        default_factory=lambda: os.getenv("UPLOAD_DIR", "temp_uploads")
    )
    max_content_mb: int = field(
        default_factory=lambda: int(os.getenv("MAX_CONTENT_MB", "16"))
    )
    frontend_dir: str = field(
        default_factory=lambda: os.getenv("FRONTEND_DIR", "frontend/dist")
    )
    host: str = field(
        default_factory=lambda: os.getenv("HOST", "0.0.0.0")
    )
    port: int = field(
        default_factory=lambda: int(os.getenv("PORT", "8000"))
    )
    allowed_extensions: frozenset = field(
        default_factory=lambda: frozenset({"png", "jpg", "jpeg", "gif", "bmp", "webp"})
    )
    # ── Public URL for tunnelling / production deployment ──────────────────
    # Set this to the externally reachable base URL of the app.
    #
    #   Local ngrok testing:   PUBLIC_URL=https://<id>.ngrok-free.app
    #   Production (Render):   PUBLIC_URL=https://nutrisense.onrender.com
    #   Production (custom):   PUBLIC_URL=https://nutrisense.yourdomain.com
    #
    # When set, GET /config returns this URL so the React frontend can build
    # the correct QR code URL for the P2P Kitchen Remote feature without
    # needing a Vite rebuild.  Leave unset during plain localhost development
    # (the frontend falls back to window.location.origin automatically).
    public_url: Optional[str] = field(
        default_factory=lambda: os.getenv("PUBLIC_URL") or None
    )
    auth_secret_key: str = field(
        default_factory=lambda: os.getenv("AUTH_SECRET_KEY", "")
    )
    auth_access_token_minutes: int = field(
        default_factory=lambda: int(os.getenv("AUTH_ACCESS_TOKEN_MINUTES", "15"))
    )
    auth_refresh_token_days: int = field(
        default_factory=lambda: int(os.getenv("AUTH_REFRESH_TOKEN_DAYS", "180"))
    )
    firebase_service_account_path: Optional[str] = field(
        default_factory=lambda: os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH") or None
    )
    firebase_service_account_json: Optional[str] = field(
        default_factory=lambda: os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON") or None
    )
    firebase_project_id: Optional[str] = field(
        default_factory=lambda: os.getenv("FIREBASE_PROJECT_ID") or None
    )
    # ── LLM providers ─────────────────────────────────────────────────────
    # Groq  — fast inference for voice/chat (free tier)
    groq_api_key: str = field(
        default_factory=lambda: os.getenv("GROQ_API_KEY", "")
    )
    groq_model: str = field(
        default_factory=lambda: os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
    )
    # Gemini — structured JSON / reasoning for /process, /chef/parse (free tier)
    gemini_api_key: str = field(
        default_factory=lambda: os.getenv("GEMINI_API_KEY", "")
    )
    gemini_model: str = field(
        default_factory=lambda: os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    )

    @property
    def max_content_bytes(self) -> int:
        return self.max_content_mb * 1024 * 1024


settings = Settings()
