"""
In-memory JTI (JWT Token ID) blacklist for logout support.

Uses an OrderedDict so revoked tokens are stored in insertion order,
enabling cheap lazy cleanup of expired entries from the front.
"""
from __future__ import annotations

import json
import logging
import os
import pathlib
import threading
import time
from collections import OrderedDict

logger = logging.getLogger(__name__)

# Saved to disk so a logged-out token stays revoked after a restart.
_BLACKLIST_FILE = pathlib.Path(os.getenv("REPORT_DIR", "data/reports")) / "revoked_jtis.json"


def _load() -> OrderedDict[str, float]:
    try:
        data = json.loads(_BLACKLIST_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return OrderedDict()
    except (OSError, ValueError) as exc:
        logger.warning("Could not read %s: %s", _BLACKLIST_FILE, exc)
        return OrderedDict()
    now = time.time()
    live = sorted((v, k) for k, v in data.items() if v > now)
    return OrderedDict((k, v) for v, k in live)


def _save() -> None:
    """Atomically write the blacklist. Called with the lock held."""
    try:
        _BLACKLIST_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _BLACKLIST_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(_blacklist), encoding="utf-8")
        os.replace(tmp, _BLACKLIST_FILE)
    except OSError as exc:
        logger.warning("Could not persist revoked tokens: %s", exc)


# {jti: expiry_unix_timestamp}
_blacklist: OrderedDict[str, float] = _load()
_lock = threading.Lock()

# How long to keep a revoked JTI (seconds).  Must be >= the longest
# token lifetime (refresh = 180 days) so a revoked token can't be
# replayed after its blacklist entry is purged.
_MAX_TTL_SECONDS: float = 180 * 24 * 60 * 60  # 180 days


def revoke(jti: str, token_exp: float | None = None) -> None:
    """Add a JTI to the blacklist.

    Parameters
    ----------
    jti:
        The JWT ``jti`` claim value to revoke.
    token_exp:
        Unix timestamp when the token expires.  If provided, the
        blacklist entry is kept until that time (+ small buffer).
        Otherwise kept for ``_MAX_TTL_SECONDS``.
    """
    if token_exp is not None:
        expiry = token_exp + 60  # 1-min buffer past token expiry
    else:
        expiry = time.time() + _MAX_TTL_SECONDS

    with _lock:
        _blacklist[jti] = expiry
        _lazy_cleanup()
        _save()


def is_revoked(jti: str) -> bool:
    """Return True if the JTI has been revoked and the entry hasn't expired."""
    with _lock:
        expiry = _blacklist.get(jti)
        if expiry is None:
            return False
        if time.time() > expiry:
            # Entry expired — remove and treat as not revoked
            _blacklist.pop(jti, None)
            return False
        return True


def _lazy_cleanup() -> None:
    """Remove expired entries from the front of the OrderedDict.

    Called inside the lock — must not acquire it again.
    """
    now = time.time()
    while _blacklist:
        jti, expiry = next(iter(_blacklist.items()))
        if now > expiry:
            _blacklist.pop(jti)
        else:
            break
