from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Tuple
from uuid import uuid4

import firebase_admin
from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError

from Backend.core.config import settings
from Backend.dependencies.neo4j import get_neo4j_client
from Backend.dependencies.jti_blacklist import is_revoked, revoke
from Backend.schemas.auth import LoginRequest, LogoutRequest, RefreshRequest, TokenPairResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Auth"])

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "nutrisense-ai"
JWT_AUDIENCE = "nutrisense-desktop"


def _get_secret_key() -> str:
    if not settings.auth_secret_key:
        raise RuntimeError("AUTH_SECRET_KEY is not configured.")
    return settings.auth_secret_key


def _get_firebase_app() -> firebase_admin.App:
    if firebase_admin._apps:
        return firebase_admin.get_app()

    if settings.firebase_service_account_json:
        cred = credentials.Certificate(json.loads(settings.firebase_service_account_json))
    elif settings.firebase_service_account_path:
        cred = credentials.Certificate(settings.firebase_service_account_path)
    else:
        cred = credentials.ApplicationDefault()

    options: Dict[str, Any] = {}
    if settings.firebase_project_id:
        options["projectId"] = settings.firebase_project_id

    return firebase_admin.initialize_app(cred, options=options or None)


def _mint_token_pair(subject: str, email: str | None, name: str | None, parent_jti: str | None = None) -> Tuple[str, str]:
    now = datetime.now(timezone.utc)
    access_expires_at = now + timedelta(minutes=settings.auth_access_token_minutes)
    refresh_expires_at = now + timedelta(days=settings.auth_refresh_token_days)
    access_jti = str(uuid4())
    refresh_jti = str(uuid4())

    access_payload = {
        "sub": subject,
        "email": email,
        "name": name,
        "type": "access",
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int(access_expires_at.timestamp()),
        "jti": access_jti,
    }
    refresh_payload = {
        "sub": subject,
        "email": email,
        "name": name,
        "type": "refresh",
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int(refresh_expires_at.timestamp()),
        "jti": refresh_jti,
        "parent_jti": parent_jti,
    }

    secret = _get_secret_key()
    access_token = jwt.encode(access_payload, secret, algorithm=JWT_ALGORITHM)
    refresh_token = jwt.encode(refresh_payload, secret, algorithm=JWT_ALGORITHM)
    return access_token, refresh_token


@router.post("/login", response_model=TokenPairResponse)
async def login(
    payload: LoginRequest,
    neo4j_client=Depends(get_neo4j_client),
) -> TokenPairResponse:
    try:
        app = _get_firebase_app()
    except Exception as exc:
        logger.exception("Firebase initialization failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service is unavailable.",
        )

    try:
        decoded = await asyncio.to_thread(
            firebase_auth.verify_id_token,
            payload.firebase_id_token,
            app,
            True,
        )
    except Exception as exc:
        logger.warning("Firebase token verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Firebase ID token.",
        )

    uid = decoded.get("uid") or decoded.get("sub")
    email = decoded.get("email")
    name = decoded.get("name")
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Firebase token missing user identifier.",
        )

    try:
        await asyncio.to_thread(neo4j_client.ensure_auth_user, uid, email, name)
    except Exception as exc:
        logger.exception("Neo4j user upsert failed for uid=%s: %s", uid, exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="User profile sync failed.",
        )

    try:
        access_token, refresh_token = _mint_token_pair(uid, email, name)
    except RuntimeError as exc:
        logger.error("JWT configuration error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication token configuration error.",
        )
    except Exception as exc:
        logger.exception("Token minting failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to issue authentication tokens.",
        )

    return TokenPairResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_in=settings.auth_access_token_minutes * 60,
        refresh_token_expires_in=settings.auth_refresh_token_days * 24 * 60 * 60,
    )


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh(payload: RefreshRequest) -> TokenPairResponse:
    try:
        decoded = jwt.decode(
            payload.refresh_token,
            _get_secret_key(),
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token expired.",
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token.",
        )
    except RuntimeError as exc:
        logger.error("JWT configuration error during refresh: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication token configuration error.",
        )

    if decoded.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type for refresh.",
        )

    # Reject revoked refresh tokens
    refresh_jti = decoded.get("jti")
    if refresh_jti and is_revoked(refresh_jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has been revoked.",
        )

    subject = decoded.get("sub")
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing subject.",
        )

    try:
        access_token, refresh_token = _mint_token_pair(
            subject=subject,
            email=decoded.get("email"),
            name=decoded.get("name"),
            parent_jti=decoded.get("jti"),
        )
    except Exception as exc:
        logger.exception("Refresh token rotation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to rotate refresh token.",
        )

    return TokenPairResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        access_token_expires_in=settings.auth_access_token_minutes * 60,
        refresh_token_expires_in=settings.auth_refresh_token_days * 24 * 60 * 60,
    )


@router.post("/logout", status_code=200)
async def logout(payload: LogoutRequest):
    """Revoke the given access + refresh tokens so they cannot be reused."""
    secret = _get_secret_key()
    revoked_count = 0

    for token in (payload.access_token, payload.refresh_token):
        try:
            decoded = jwt.decode(
                token,
                secret,
                algorithms=[JWT_ALGORITHM],
                audience=JWT_AUDIENCE,
                issuer=JWT_ISSUER,
                options={"verify_exp": False},  # allow already-expired tokens
            )
            jti = decoded.get("jti")
            exp = decoded.get("exp")
            if jti:
                revoke(jti, token_exp=exp)
                revoked_count += 1
        except JWTError:
            # Silently skip malformed tokens — the user is logging out anyway
            pass

    return {"revoked": revoked_count}
