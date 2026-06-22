"""Upload hardening: MIME sniffing, storage cleanup, duplicate warnings, enqueue fallback."""

from __future__ import annotations

import io
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
import src.receipt.handlers.api.v1.router as router_mod
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.receipt_ocr.mime import sniff_mime
from src.seller.models import Seller

_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 12
_PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 12
_PDF = b"%PDF-1.4\n%fake"
_WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 "


def _seller_token(tid: int = 12345) -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = tid
    return jwt_auth.create_token(seller)


# ---------------------------------------------------------------------------
# sniff_mime
# ---------------------------------------------------------------------------


def test_sniff_mime__recognizes_supported_formats() -> None:
    assert sniff_mime(_JPEG) == "image/jpeg"
    assert sniff_mime(_PNG) == "image/png"
    assert sniff_mime(_WEBP) == "image/webp"
    assert sniff_mime(_PDF) == "application/pdf"


def test_sniff_mime__rejects_fakes_and_unknown() -> None:
    assert sniff_mime(b"hello, this is text") is None
    assert sniff_mime(b"") is None
    assert sniff_mime(b"GIF89a...") is None  # gif not accepted


# ---------------------------------------------------------------------------
# _build_upload_warnings (router internal) — duplicate detection
# ---------------------------------------------------------------------------


def _session_with_scalar(value: object) -> MagicMock:
    session = MagicMock(spec=AsyncSession)
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    session.execute = AsyncMock(return_value=result)
    return session


@pytest.mark.asyncio
async def test_warnings__duplicate_file_hash__possible_duplicate() -> None:
    session = _session_with_scalar(777)  # a prior attachment shares the hash
    warnings = await router_mod._build_upload_warnings(
        session, receipt_id=1, file_hashes=["h1"], scanned_qr=None
    )
    assert [w.code for w in warnings] == ["POSSIBLE_DUPLICATE"]


@pytest.mark.asyncio
async def test_warnings__no_duplicate__empty() -> None:
    session = _session_with_scalar(None)
    warnings = await router_mod._build_upload_warnings(
        session, receipt_id=1, file_hashes=["h1"], scanned_qr=None
    )
    assert warnings == []


@pytest.mark.asyncio
async def test_warnings__scanned_qr_duplicate__possible_duplicate() -> None:
    session = _session_with_scalar(888)
    qr = "t=20260610T1430&s=599.00&fn=1234567890&i=12345&fp=67890&n=1"
    warnings = await router_mod._build_upload_warnings(session, receipt_id=1, file_hashes=[], scanned_qr=qr)
    assert [w.code for w in warnings] == ["POSSIBLE_DUPLICATE"]


# ---------------------------------------------------------------------------
# MIME sniffing at the upload endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_upload__fake_jpeg_text_bytes__returns_415(client: AsyncClient, app: Any) -> None:
    """A text file relabelled image/jpeg is rejected by server-side sniffing."""
    token = _seller_token()
    resp = await client.post(
        "/api/v1/receipts/upload",
        files=[("files", ("evil.jpg", io.BytesIO(b"totally not an image"), "image/jpeg"))],
        data={"brand_id": "1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 415, resp.text
    assert resp.json()["code"] == "RECEIPT_UNSUPPORTED_TYPE"


@pytest.mark.asyncio
async def test_upload__partial_invalid_package__cleans_up_saved_files(client: AsyncClient, app: Any) -> None:
    """First file saved, second invalid → 415 AND the first saved object is deleted."""
    token = _seller_token()
    deleted: list[str] = []
    original_save = router_mod._storage.save
    original_delete = router_mod._storage.delete
    router_mod._storage.save = AsyncMock(return_value="local://saved-1.jpg")
    router_mod._storage.delete = AsyncMock(side_effect=lambda uri: deleted.append(uri))
    try:
        resp = await client.post(
            "/api/v1/receipts/upload",
            files=[
                ("files", ("a.jpg", io.BytesIO(_JPEG), "image/jpeg")),
                ("files", ("b.jpg", io.BytesIO(b"not an image"), "image/jpeg")),
            ],
            data={"brand_id": "1"},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        router_mod._storage.save = original_save
        router_mod._storage.delete = original_delete

    assert resp.status_code == 415, resp.text
    assert deleted == ["local://saved-1.jpg"], "the already-saved first file must be cleaned up"


# ---------------------------------------------------------------------------
# Enqueue reliability
# ---------------------------------------------------------------------------


def _request_with_pool(pool: object | None) -> MagicMock:
    from types import SimpleNamespace  # noqa: PLC0415

    request = MagicMock()
    request.app.state = SimpleNamespace() if pool is None else SimpleNamespace(arq_pool=pool)
    return request


@pytest.mark.asyncio
async def test_enqueue__no_pool__returns_false() -> None:
    assert await router_mod._enqueue_processing(_request_with_pool(None), 1) is False


@pytest.mark.asyncio
async def test_enqueue__pool_ok__returns_true_with_deterministic_job_id() -> None:
    pool = MagicMock()
    pool.enqueue_job = AsyncMock(return_value=MagicMock())
    ok = await router_mod._enqueue_processing(_request_with_pool(pool), 42, job_id="receipt-42")
    assert ok is True
    pool.enqueue_job.assert_awaited_once()
    assert pool.enqueue_job.await_args.kwargs.get("_job_id") == "receipt-42"


@pytest.mark.asyncio
async def test_enqueue__pool_raises__returns_false() -> None:
    pool = MagicMock()
    pool.enqueue_job = AsyncMock(side_effect=RuntimeError("redis down"))
    assert await router_mod._enqueue_processing(_request_with_pool(pool), 7) is False
