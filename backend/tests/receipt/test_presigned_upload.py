"""Tests for presigned S3 upload endpoints.

    test_upload_url__valid_mime__returns_signed_post
    test_upload_url__invalid_mime__returns_415_RECEIPT_UNSUPPORTED_TYPE
    test_finalize__valid_uri__creates_receipt
    test_finalize__uri_from_other_seller__returns_403
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.receipt_ocr.storage import S3FileStorage
from src.seller.models import Seller

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seller_token(telegram_id: int = 12345) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _make_s3_storage() -> S3FileStorage:
    """Build an S3FileStorage with a fake client injected."""
    storage = S3FileStorage(
        bucket="test-bucket",
        endpoint_url=None,
        access_key="test",
        secret_key="test",
        region="us-east-1",
        prefix="receipts/",
    )

    client_mock = MagicMock()

    async def generate_presigned_post(bucket, key, Fields, Conditions, ExpiresIn):  # noqa: N803
        return {
            "url": f"https://fake-s3.example.com/{bucket}",
            "fields": {**Fields, "key": key, "X-Amz-Signature": "fakesig"},
        }

    async def get_object(*, Bucket: str, Key: str) -> dict:  # noqa: N803
        # Key format: receipts/<telegram_id>/<uuid>.<ext>
        # Return deterministic fake bytes based on key.
        data = b"\xff\xd8\xff\xe0" + b"\x00" * 12  # minimal JPEG bytes
        body_mock = AsyncMock()
        body_mock.read = AsyncMock(return_value=data)
        return {"Body": body_mock}

    client_mock.generate_presigned_post = generate_presigned_post
    client_mock.get_object = get_object
    client_mock.exceptions = MagicMock()
    client_mock.exceptions.NoSuchKey = type("NoSuchKey", (Exception,), {})

    @asynccontextmanager
    async def _fake_make_client():
        yield client_mock

    storage._make_client = _fake_make_client  # type: ignore[method-assign]
    return storage


# ---------------------------------------------------------------------------
# T1 — POST /receipts/upload-url
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_url__valid_mime__returns_signed_post(client: AsyncClient, app: Any) -> None:
    """Valid MIME → 200 with upload_url, fields, storage_uri, expires_in."""
    token = _seller_token(12345)

    fake_storage = _make_s3_storage()
    import src.receipt.handlers.api.v1.router as router_mod  # noqa: PLC0415

    original = router_mod._storage
    router_mod._storage = fake_storage
    try:
        response = await client.post(
            "/api/v1/receipts/upload-url",
            json={"mime": "image/jpeg"},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        router_mod._storage = original

    assert response.status_code == 200, response.text
    data = response.json()
    assert "upload_url" in data
    assert "fields" in data
    assert "storage_uri" in data
    assert data["expires_in"] == 600
    assert data["storage_uri"].startswith("s3://test-bucket/receipts/12345/")


@pytest.mark.asyncio
async def test_upload_url__invalid_mime__returns_415_RECEIPT_UNSUPPORTED_TYPE(
    client: AsyncClient, app: Any
) -> None:
    """Unsupported MIME → 415 with RECEIPT_UNSUPPORTED_TYPE code."""
    token = _seller_token(12345)

    fake_storage = _make_s3_storage()
    import src.receipt.handlers.api.v1.router as router_mod  # noqa: PLC0415

    original = router_mod._storage
    router_mod._storage = fake_storage
    try:
        response = await client.post(
            "/api/v1/receipts/upload-url",
            json={"mime": "text/plain"},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        router_mod._storage = original

    assert response.status_code == 415, response.text
    body = response.json()
    # AppError handler produces {"code": ..., "user_message": ..., "debug_id": ...}
    assert body.get("code") == "RECEIPT_UNSUPPORTED_TYPE"


# ---------------------------------------------------------------------------
# T2 — POST /receipts/finalize
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_finalize__valid_uri__creates_receipt(client: AsyncClient, app: Any) -> None:
    """Valid storage_uri owned by seller → 202 ReceiptUploadResponse."""
    seller_id = 12345
    token = _seller_token(seller_id)

    # Build a URI that passes the prefix check: receipts/<seller_id>/...
    storage_uri = f"s3://test-bucket/receipts/{seller_id}/abc123.jpg"

    fake_storage = _make_s3_storage()
    import src.receipt.handlers.api.v1.router as router_mod  # noqa: PLC0415

    original_storage = router_mod._storage
    router_mod._storage = fake_storage

    from src.app.depends import get_pg_session  # noqa: PLC0415

    # Build mock session.  session.add() immediately stamps id=99 on the receipt
    # object so that receipt.id is available after the await session.flush() call.
    mock_session = MagicMock(spec=AsyncSession)
    mock_session.flush = AsyncMock()
    mock_session.commit = AsyncMock()

    def _capture_add(obj: object) -> None:
        obj.id = 99  # type: ignore[attr-defined]

    mock_session.add = _capture_add

    async def _mock_session():
        yield mock_session

    app.dependency_overrides[get_pg_session] = _mock_session

    try:
        with patch.object(router_mod._fraud_checker, "check_file_hash", new=AsyncMock(return_value=None)):
            response = await client.post(
                "/api/v1/receipts/finalize",
                json={"storage_uri": storage_uri, "mime": "image/jpeg", "brand_id": 1},
                headers={"Authorization": f"Bearer {token}"},
            )
    finally:
        router_mod._storage = original_storage

    assert response.status_code == 202, response.text
    data = response.json()
    assert data["receipt_id"] == 99


@pytest.mark.asyncio
async def test_finalize__uri_from_other_seller__returns_403(client: AsyncClient, app: Any) -> None:
    """URI namespaced to a different seller → 403 RECEIPT_NOT_YOURS."""
    seller_id = 12345
    other_seller_id = 99999
    token = _seller_token(seller_id)

    # URI belongs to other_seller_id, not seller_id=12345.
    storage_uri = f"s3://test-bucket/receipts/{other_seller_id}/abc123.jpg"

    fake_storage = _make_s3_storage()
    import src.receipt.handlers.api.v1.router as router_mod  # noqa: PLC0415

    original = router_mod._storage
    router_mod._storage = fake_storage
    try:
        response = await client.post(
            "/api/v1/receipts/finalize",
            json={"storage_uri": storage_uri, "mime": "image/jpeg", "brand_id": 1},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        router_mod._storage = original

    assert response.status_code == 403, response.text
    body = response.json()
    assert body.get("code") == "RECEIPT_NOT_YOURS"
