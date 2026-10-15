"""
Per-user LLM rate limiting.

Uses a contextvars.ContextVar to propagate the current user's UID from the
HTTP middleware into the LLM client layer — no method signature changes needed.

Two sliding windows per user:
  - 20 requests / minute
  - 200 requests / day

Anonymous (unauthenticated) requests share a single ``__anonymous__`` bucket.
"""

from __future__ import annotations

import contextvars
import logging
import time
from collections import defaultdict

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

# ── Context variable: set by middleware, read by CachedLLMClient ─────────
current_user_uid: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_user_uid", default=None,
)

# ── Configuration ────────────────────────────────────────────────────────
RATE_LIMIT_PER_MINUTE = 20
RATE_LIMIT_PER_DAY = 200

_ANON_KEY = "__anonymous__"


class _UserBucket:
    """Sliding-window counter for a single user."""

    __slots__ = ("minute_timestamps", "day_timestamps")

    def __init__(self) -> None:
        self.minute_timestamps: list[float] = []
        self.day_timestamps: list[float] = []

    def check_and_record(self) -> None:
        now = time.monotonic()

        # Prune expired entries
        one_minute_ago = now - 60
        one_day_ago = now - 86_400
        self.minute_timestamps = [t for t in self.minute_timestamps if t > one_minute_ago]
        self.day_timestamps = [t for t in self.day_timestamps if t > one_day_ago]

        if len(self.minute_timestamps) >= RATE_LIMIT_PER_MINUTE:
            logger.warning("Rate limit (per-minute) hit for uid=%s", current_user_uid.get())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded: max {RATE_LIMIT_PER_MINUTE} AI requests per minute.",
            )
        if len(self.day_timestamps) >= RATE_LIMIT_PER_DAY:
            logger.warning("Rate limit (daily) hit for uid=%s", current_user_uid.get())
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Daily limit exceeded: max {RATE_LIMIT_PER_DAY} AI requests per day.",
            )

        self.minute_timestamps.append(now)
        self.day_timestamps.append(now)


_buckets: dict[str, _UserBucket] = defaultdict(_UserBucket)


def enforce_rate_limit() -> None:
    """Check rate limits for the current user (from context var). Raises HTTP 429."""
    uid = current_user_uid.get() or _ANON_KEY
    _buckets[uid].check_and_record()
