"""Functional tests for the signed receipt-image proxy endpoint.

GET /api/v1/receipts/attachments/file?sig=… — unauthenticated, signature-gated,
streams object bytes through the backend so the browser never touches MinIO.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from src.receipt.handlers.api.v1 import router as receipt_router
from src.receipt_ocr.image_token import sign_image_uri

_URI = "s3://vliq-receipts/receipts/abc123.png"
_PATH = "/api/v1/receipts/attachments/file"


async def test_valid_signature_streams_bytes_with_content_type(client, monkeypatch) -> None:
    monkeypatch.setattr(receipt_router._storage, "read", AsyncMock(return_value=b"PNGDATA"))
    resp = await client.get(_PATH, params={"sig": sign_image_uri(_URI)})
    assert resp.status_code == 200
    assert resp.content == b"PNGDATA"
    assert resp.headers["content-type"] == "image/png"
    assert "max-age" in resp.headers.get("cache-control", "")


async def test_invalid_signature_is_forbidden(client) -> None:
    resp = await client.get(_PATH, params={"sig": "garbage"})
    assert resp.status_code == 403


async def test_missing_object_is_not_found(client, monkeypatch) -> None:
    monkeypatch.setattr(
        receipt_router._storage, "read", AsyncMock(side_effect=FileNotFoundError())
    )
    resp = await client.get(_PATH, params={"sig": sign_image_uri(_URI)})
    assert resp.status_code == 404
