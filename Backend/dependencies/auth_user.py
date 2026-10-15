"""
Phase 6.5 — FastAPI dependencies for JWT access-token verification.

Provides two dependencies:
  get_current_user   — raises HTTP 401 if no valid token is present.
  get_optional_user  — returns None silently if no/invalid token.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError

from Backend.core.config import settings
from Backend.dependencies.jti_blacklist import is_revoked

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)

JWT_ALGORITHM = "HS256"
JWT_ISSUER    = "nutrisense-ai"
JWT_AUDIENCE  = "nutrisense-desktop"


def _decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decode and validate a JWT access token.
    Returns the payload dict, or None if invalid / expired.
    """
    secret = settings.auth_secret_key
    if not secret:
        return None

    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
        )
    except ExpiredSignatureError:
        logger.debug("Access token expired.")
        return None
    except JWTError as exc:
        logger.debug("JWT decode error: %s", exc)
        return None

    if payload.get("type") != "access":
        return None

    # Reject revoked tokens (logout)
    jti = payload.get("jti")
    if jti and is_revoked(jti):
        logger.debug("Access token JTI %s has been revoked.", jti)
        return None

    return payload


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Dict[str, Any]:
    """
    Require a valid Bearer access token.
    Raises HTTP 401 if missing or invalid.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    uid = payload.get("sub")
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access token missing subject claim.",
        )

    return {
        "uid":   uid,
        "email": payload.get("email"),
        "name":  payload.get("name"),
    }


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[Dict[str, Any]]:
    """
    Optionally parse a Bearer access token.
    Returns None (no error) when the header is absent or invalid.
    Used for passive interaction logging on public endpoints.
    """
    if not credentials:
        return None

    payload = _decode_access_token(credentials.credentials)
    if payload is None:
        return None

    uid = payload.get("sub")
    if not uid:
        return None

    return {
        "uid":   uid,
        "email": payload.get("email"),
        "name":  payload.get("name"),
    }
