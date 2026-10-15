"""
Caching + rate-limiting wrapper for any LLM client.

Wraps a client that exposes the standard 4-method interface
(generate, generate_async, generate_json, generate_json_async)
and adds:

  1. Prompt-level response caching (TTLCache, 10 min, 500 slots).
     If 50 users ask for nutrition of "Paneer Butter Masala", only
     the first triggers an API call.

  2. Per-user rate-limit enforcement via the context-var rate limiter
     in Backend.dependencies.rate_limiter.
"""

from __future__ import annotations

import hashlib
import logging
import threading

from cachetools import TTLCache

from Backend.dependencies.rate_limiter import enforce_rate_limit

logger = logging.getLogger(__name__)

# Shared cache: 500 entries, 10-minute TTL
_cache: TTLCache = TTLCache(maxsize=500, ttl=600)
_lock = threading.Lock()


def _cache_key(method: str, prompt: str) -> str:
    return hashlib.sha256(f"{method}:{prompt}".encode()).hexdigest()


class CachedLLMClient:
    """
    Transparent wrapper — same 4-method interface as GroqLLMClient / GeminiLLMClient.
    """

    def __init__(self, inner_client) -> None:
        self._inner = inner_client

    # ── Text generation ──────────────────────────────────────────────────

    def generate(self, prompt: str) -> str:
        key = _cache_key("generate", prompt)
        with _lock:
            cached = _cache.get(key)
        if cached is not None:
            logger.debug("Cache hit (generate)")
            return cached
        enforce_rate_limit()
        result = self._inner.generate(prompt)
        with _lock:
            _cache[key] = result
        return result

    async def generate_async(self, prompt: str) -> str:
        key = _cache_key("generate_async", prompt)
        cached = _cache.get(key)
        if cached is not None:
            logger.debug("Cache hit (generate_async)")
            return cached
        enforce_rate_limit()
        result = await self._inner.generate_async(prompt)
        _cache[key] = result
        return result

    # ── Structured JSON generation ───────────────────────────────────────

    def generate_json(self, prompt: str) -> dict:
        key = _cache_key("generate_json", prompt)
        with _lock:
            cached = _cache.get(key)
        if cached is not None:
            logger.debug("Cache hit (generate_json)")
            return cached
        enforce_rate_limit()
        result = self._inner.generate_json(prompt)
        with _lock:
            _cache[key] = result
        return result

    async def generate_json_async(self, prompt: str) -> dict:
        key = _cache_key("generate_json_async", prompt)
        cached = _cache.get(key)
        if cached is not None:
            logger.debug("Cache hit (generate_json_async)")
            return cached
        enforce_rate_limit()
        result = await self._inner.generate_json_async(prompt)
        _cache[key] = result
        return result
