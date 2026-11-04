"""Validation for the session IDs used by the voice and kitchen channels.

These sessions have no login: the phone joins by scanning a QR code, so knowing
the ID is what grants access. IDs must therefore be long enough not to be guessed.
"""
import re

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{12,64}$")


def is_valid_session_id(session_id: str) -> bool:
    return bool(_SESSION_ID_RE.fullmatch(session_id))
