"""
In-memory JTI (JWT Token ID) blacklist for logout support.

Uses an OrderedDict so revoked tokens are stored in insertion order,
enabling cheap lazy cleanup of expired entries from the front.
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict

# {jti: expiry_unix_timestamp}
_blacklist: OrderedDict[str, float] = OrderedDict()
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
