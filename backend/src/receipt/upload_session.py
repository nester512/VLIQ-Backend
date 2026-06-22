"""Signed upload-session tokens for the package upload flow.

``/receipts/upload-urls`` issues presigned storage keys and returns a signed token
binding those keys to the seller. ``/receipts/finalize`` verifies the token so a
client cannot finalize a receipt with a storage key it was never granted (or one
belonging to another seller). HS256 over the app's ``JWT_SECRET_SALT`` — no new
dependency (reuses ``jose``, already used by auth).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from src.app.depends import get_config

_settings = get_config()
_SECRET = _settings.JWT_SECRET_SALT
_ALG = "HS256"
_TYP = "upload_session"
# Must outlive the presigned upload window (presigned POST TTL = 600s) plus client
# upload time; 30 min is comfortable and short enough.
UPLOAD_SESSION_TTL = timedelta(minutes=30)


class UploadSessionError(Exception):
    """Raised when an upload-session token is missing, invalid, expired, or not the seller's."""


def sign_upload_session(*, seller_id: int, keys: list[str]) -> str:
    """Sign a token binding *keys* (storage URIs) to *seller_id*."""
    now = datetime.now(tz=UTC)
    payload = {
        "typ": _TYP,
        "sub": str(seller_id),
        "keys": keys,
        "iat": int(now.timestamp()),
        "exp": int((now + UPLOAD_SESSION_TTL).timestamp()),
    }
    return jwt.encode(payload, _SECRET, algorithm=_ALG)


def verify_upload_session(token: str, *, seller_id: int) -> list[str]:
    """Verify *token* belongs to *seller_id* and return the granted storage keys.

    Raises:
        UploadSessionError: invalid signature, wrong type, expired, or seller mismatch.
    """
    try:
        claims = jwt.decode(token, _SECRET, algorithms=[_ALG])
    except JWTError as exc:
        raise UploadSessionError(f"Invalid upload session token: {exc}") from exc
    if claims.get("typ") != _TYP:
        raise UploadSessionError("Not an upload-session token")
    if str(claims.get("sub")) != str(seller_id):
        raise UploadSessionError("Upload session does not belong to this seller")
    keys = claims.get("keys")
    if not isinstance(keys, list):
        raise UploadSessionError("Upload session has no keys")
    return [str(k) for k in keys]
