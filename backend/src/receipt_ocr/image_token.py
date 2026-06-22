"""Signed, short-lived tokens for browser-viewable receipt image URLs.

The TMA renders receipt photos with a plain ``<img src=…>``, which cannot carry
the ``Authorization`` header the JSON API uses. So rather than expose MinIO
directly (an internal ``minio:9000`` host, plain HTTP, no public Caddy route) we
hand the browser a *signed* URL pointing back at our own API:

    /api/v1/receipts/attachments/file?sig=<token>

A ``GET`` on that path (see the receipt router) verifies the signature and
streams the object bytes through the backend — over the same HTTPS origin Caddy
already proxies (``/api/*``), with the bucket staying private.

HS256 over the app's ``JWT_SECRET_SALT`` reusing ``jose`` (no new dependency),
mirroring :mod:`src.receipt.upload_session`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

from jose import JWTError, jwt

from src.app.depends import get_config

_settings = get_config()
_SECRET = _settings.JWT_SECRET_SALT
_ALG = "HS256"
_TYP = "image_access"

# The URL is minted fresh on every API response that returns a receipt, so a
# short-ish lifetime is fine — long enough that an open detail view keeps
# rendering its images without a refetch.
IMAGE_URL_TTL = timedelta(hours=6)

# Path of the streaming endpoint (see src/receipt/handlers/api/v1/router.py).
# Two segments (``attachments/file``) so it can never be captured by the
# ``/receipts/{receipt_id}`` route.
IMAGE_PROXY_PATH = f"{_settings.PATH_PREFIX}/receipts/attachments/file"


class ImageTokenError(Exception):
    """Raised when an image-access token is missing, invalid, or expired."""


def sign_image_uri(uri: str) -> str:
    """Sign a short-lived token granting GET access to one storage *uri*."""
    now = datetime.now(tz=UTC)
    payload = {
        "typ": _TYP,
        "uri": uri,
        "iat": int(now.timestamp()),
        "exp": int((now + IMAGE_URL_TTL).timestamp()),
    }
    return jwt.encode(payload, _SECRET, algorithm=_ALG)


def verify_image_uri(token: str) -> str:
    """Verify *token* and return the storage URI it grants access to.

    Raises:
        ImageTokenError: invalid/expired signature, or wrong token type.
    """
    try:
        claims = jwt.decode(token, _SECRET, algorithms=[_ALG])
    except JWTError as exc:
        raise ImageTokenError(f"Invalid image token: {exc}") from exc
    if claims.get("typ") != _TYP:
        raise ImageTokenError("Not an image-access token")
    uri = claims.get("uri")
    if not isinstance(uri, str) or not uri:
        raise ImageTokenError("Image token has no uri")
    return uri


def build_image_proxy_url(uri: str) -> str:
    """Return a signed, same-origin proxy URL that serves *uri* to the browser."""
    return f"{IMAGE_PROXY_PATH}?{urlencode({'sig': sign_image_uri(uri)})}"
