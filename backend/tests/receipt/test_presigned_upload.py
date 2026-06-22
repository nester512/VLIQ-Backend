"""Tests for the package upload endpoints (upload-urls + finalize + multipart upload).

    test_upload_urls__valid__returns_session_and_slots
    test_upload_urls__invalid_mime__returns_415
    test_upload_urls__not_s3_backend__returns_501
    test_finalize__valid_session__creates_receipt
    test_finalize__key_not_in_session__returns_403
    test_finalize__invalid_session__returns_403
    test_upload__single_file__returns_202
    test_upload__mixed_image_and_pdf__returns_202
    test_upload__duplicate_file__still_created_no_409   (spec S3/В-3: dup = signal, not block)
    test_upload__six_files__returns_400
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.receipt.upload_session import sign_upload_session
from src.receipt_ocr.storage import S3FileStorage
from src.seller.models import Seller

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 12


def _seller_token(telegram_id: int = 12345) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = telegram_id
    return jwt_auth.create_token(seller)


def _make_s3_storage() -> S3FileStorage:
    """S3FileStorage with a fake client (presigned POST + get_object)."""
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
        return {"url": f"https://fake-s3.example.com/{bucket}", "fields": {**Fields, "key": key}}

    async def get_object(*, Bucket: str, Key: str) -> dict:  # noqa: N803
        body_mock = AsyncMock()
        body_mock.read = AsyncMock(return_value=_JPEG)
        return {"Body": body_mock}

    client_mock.generate_presigned_post = generate_presigned_post
    client_mock.get_object = get_object
    client_mock.put_object = AsyncMock(return_value={})
    client_mock.exceptions = MagicMock()
    client_mock.exceptions.NoSuchKey = type("NoSuchKey", (Exception,), {})

    @asynccontextmanager
    async def _fake_make_client():
        yield client_mock

    storage._make_client = _fake_make_client  # type: ignore[method-assign]
    return storage


def _override_session(app: Any, existing: object | None = None) -> MagicMock:
    """Override get_pg_session with a create-capable mock session."""
    from src.app.depends import get_pg_session  # noqa: PLC0415

    session = MagicMock(spec=AsyncSession)
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=existing)
    session.execute = AsyncMock(return_value=result)

    begin_cm = MagicMock()
    begin_cm.__aenter__ = AsyncMock(return_value=None)
    begin_cm.__aexit__ = AsyncMock(return_value=False)
    session.begin = MagicMock(return_value=begin_cm)

    def _add(obj: object) -> None:
        if getattr(obj, "id", None) is None:
            obj.id = 99  # type: ignore[attr-defined]

    session.add = MagicMock(side_effect=_add)
    session.refresh = AsyncMock()
    session.rollback = AsyncMock()

    async def _gen():
        yield session

    app.dependency_overrides[get_pg_session] = _gen
    return session


@asynccontextmanager
async def _swap_storage(storage):
    import src.receipt.handlers.api.v1.router as router_mod  # noqa: PLC0415

    original = router_mod._storage
    router_mod._storage = storage
    try:
        yield
    finally:
        router_mod._storage = original


# ---------------------------------------------------------------------------
# upload-urls
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload_urls__valid__returns_session_and_slots(client: AsyncClient, app: Any) -> None:
    token = _seller_token(12345)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/upload-urls",
            json={
                "files": [
                    {"client_id": "a", "filename": "a.jpg", "mime": "image/jpeg", "size": 100},
                    {"client_id": "b", "filename": "b.pdf", "mime": "application/pdf", "size": 200},
                ]
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["upload_session"]
    assert len(data["files"]) == 2
    assert [s["position"] for s in data["files"]] == [0, 1]
    assert data["files"][0]["storage_uri"].startswith("s3://test-bucket/receipts/12345/")


@pytest.mark.asyncio
async def test_upload_urls__invalid_mime__returns_415(client: AsyncClient, app: Any) -> None:
    token = _seller_token(12345)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/upload-urls",
            json={"files": [{"client_id": "a", "filename": "a.txt", "mime": "text/plain", "size": 100}]},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 415, resp.text
    assert resp.json()["code"] == "RECEIPT_UNSUPPORTED_TYPE"


@pytest.mark.asyncio
async def test_upload_urls__not_s3_backend__returns_501(client: AsyncClient, app: Any) -> None:
    # Default _storage is LocalFileStorage → presigned not supported.
    token = _seller_token(12345)
    resp = await client.post(
        "/api/v1/receipts/upload-urls",
        json={"files": [{"client_id": "a", "filename": "a.jpg", "mime": "image/jpeg", "size": 100}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 501, resp.text


# ---------------------------------------------------------------------------
# finalize
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_finalize__valid_session__creates_receipt(client: AsyncClient, app: Any) -> None:
    seller_id = 12345
    token = _seller_token(seller_id)
    storage_uri = f"s3://test-bucket/receipts/{seller_id}/a.jpg"
    session_token = sign_upload_session(seller_id=seller_id, keys=[storage_uri])

    _override_session(app)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/finalize",
            json={
                "upload_session": session_token,
                "brand_id": 1,
                "idempotency_key": "idem-12345678",
                "attachments": [{"position": 0, "storage_uri": storage_uri, "mime": "image/jpeg"}],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 202, resp.text
    assert resp.json()["receipt_id"] == 99


@pytest.mark.asyncio
async def test_finalize__key_not_in_session__returns_403(client: AsyncClient, app: Any) -> None:
    seller_id = 12345
    token = _seller_token(seller_id)
    # Session grants a DIFFERENT key than the one being finalized.
    session_token = sign_upload_session(seller_id=seller_id, keys=[f"s3://test-bucket/receipts/{seller_id}/other.jpg"])
    _override_session(app)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/finalize",
            json={
                "upload_session": session_token,
                "brand_id": 1,
                "idempotency_key": "idem-12345678",
                "attachments": [
                    {"position": 0, "storage_uri": f"s3://test-bucket/receipts/{seller_id}/a.jpg", "mime": "image/jpeg"}
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "RECEIPT_NOT_YOURS"


@pytest.mark.asyncio
async def test_finalize__invalid_session__returns_403(client: AsyncClient, app: Any) -> None:
    token = _seller_token(12345)
    resp = await client.post(
        "/api/v1/receipts/finalize",
        json={
            "upload_session": "not-a-real-token",
            "brand_id": 1,
            "idempotency_key": "idem-12345678",
            "attachments": [{"position": 0, "storage_uri": "s3://test-bucket/receipts/12345/a.jpg", "mime": "image/jpeg"}],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["code"] == "RECEIPT_UPLOAD_SESSION_INVALID"


# ---------------------------------------------------------------------------
# multipart batch upload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload__single_file__returns_202(client: AsyncClient, app: Any) -> None:
    token = _seller_token(12345)
    _override_session(app)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/upload",
            files=[("files", ("a.jpg", _JPEG, "image/jpeg"))],
            data={"brand_id": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 202, resp.text
    assert resp.json()["receipt_id"] == 99


@pytest.mark.asyncio
async def test_upload__mixed_image_and_pdf__returns_202(client: AsyncClient, app: Any) -> None:
    token = _seller_token(12345)
    _override_session(app)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/upload",
            files=[
                ("files", ("a.jpg", _JPEG, "image/jpeg")),
                ("files", ("b.pdf", b"%PDF-1.4 fake", "application/pdf")),
            ],
            data={"brand_id": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 202, resp.text


@pytest.mark.asyncio
async def test_upload__duplicate_file__still_created_no_409(client: AsyncClient, app: Any) -> None:
    """Spec S3/В-3: a repeated file is a fraud *signal* later, never a hard 409 at ingest."""
    token = _seller_token(12345)
    _override_session(app)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/upload",
            files=[("files", ("dup.jpg", _JPEG, "image/jpeg"))],
            data={"brand_id": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 202, resp.text


@pytest.mark.asyncio
async def test_upload__six_files__returns_400(client: AsyncClient, app: Any) -> None:
    token = _seller_token(12345)
    _override_session(app)
    async with _swap_storage(_make_s3_storage()):
        resp = await client.post(
            "/api/v1/receipts/upload",
            files=[("files", (f"f{i}.jpg", _JPEG, "image/jpeg")) for i in range(6)],
            data={"brand_id": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert resp.status_code == 400, resp.text
