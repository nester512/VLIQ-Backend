"""Unit tests for signed receipt-image access tokens."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from jose import jwt
from src.receipt_ocr import image_token
from src.receipt_ocr.image_token import (
    ImageTokenError,
    build_image_proxy_url,
    sign_image_uri,
    verify_image_uri,
)

_URI = "s3://vliq-receipts/receipts/abc123.jpg"


def test_sign_verify_roundtrip() -> None:
    token = sign_image_uri(_URI)
    assert verify_image_uri(token) == _URI


def test_tampered_token_rejected() -> None:
    token = sign_image_uri(_URI)
    with pytest.raises(ImageTokenError):
        verify_image_uri(token + "x")


def test_garbage_token_rejected() -> None:
    with pytest.raises(ImageTokenError):
        verify_image_uri("not-a-jwt")


def test_wrong_token_type_rejected() -> None:
    # A validly-signed JWT but with the wrong ``typ`` must not grant image access.
    bad = jwt.encode(
        {"typ": "upload_session", "uri": _URI},
        image_token._SECRET,
        algorithm=image_token._ALG,
    )
    with pytest.raises(ImageTokenError):
        verify_image_uri(bad)


def test_expired_token_rejected() -> None:
    past = datetime.now(tz=UTC) - timedelta(hours=1)
    expired = jwt.encode(
        {
            "typ": image_token._TYP,
            "uri": _URI,
            "iat": int((past - timedelta(hours=6)).timestamp()),
            "exp": int(past.timestamp()),
        },
        image_token._SECRET,
        algorithm=image_token._ALG,
    )
    with pytest.raises(ImageTokenError):
        verify_image_uri(expired)


def test_proxy_url_shape_and_roundtrip() -> None:
    url = build_image_proxy_url(_URI)
    assert url.startswith("/api/v1/receipts/attachments/file?sig=")
    # JWT chars (base64url + '.') are urlencode-safe, so the token is literal.
    sig = url.split("sig=", 1)[1]
    assert verify_image_uri(sig) == _URI
