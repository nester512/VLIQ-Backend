"""Admin receipt DTOs must never leak a non-viewable storage URI in ``file_url``.

Regression: ``GET /receipts/{id}`` (and the list/build paths) used to do
``to_viewable_url(file_url) or file_url``, which for a ``seed://`` / ``local://``
URI leaked the raw scheme. The admin frontend then synthesised
``<img src="seed://…">`` → a broken image on the review deck, while the seller
side (no ``or`` fallback) rendered cleanly. The fallback is now dropped:
non-viewable URIs serialise to ``None`` and ``s3://`` to a signed proxy URL.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.receipt.models import Receipt, ReceiptFileKind

PREFIX = "/api/v1/receipts"


def _make_receipt(file_url: str) -> Receipt:
    r = MagicMock(spec=Receipt)
    r.id = 1
    r.seller_id = 12345
    r.brand_id = 1
    r.status = "on_review"
    r.bonus_amount = 100
    r.rejection_reason = None
    r.rejection_code = None
    r.file_kind = ReceiptFileKind.photo
    r.file_url = file_url
    r.file_hash = "abc123"
    r.purchase_date = None
    r.total_sum = None
    r.shop_name = None
    r.shop_inn = None
    r.qr_raw = None
    r.fn = None
    r.fd = None
    r.fp = None
    r.ocr_confidence = None
    r.ocr_raw = None
    r.items = []
    r.fraud_signals = []
    r.attachments = []
    r.admin_comments = []
    r.is_deleted = False
    r.created_at = datetime(2025, 1, 1, 12, 0, 0)
    r.updated_at = None
    r.created_by = None
    r.updated_by = None
    return r


def _admin_token() -> str:
    from src.admin.models import Admin, AdminRole

    admin = MagicMock(spec=Admin)
    admin.telegram_id = 999
    admin.role = AdminRole.admin
    admin.is_active = True
    return jwt_auth.create_token(admin)


def _use_session(app, receipt: Receipt) -> None:
    """Override get_pg_session so both the receipt fetch and the seller join resolve."""
    result = MagicMock()
    result.scalar_one_or_none.return_value = receipt
    result.scalars.return_value.all.return_value = []  # _attach_seller_info → no rows

    session = MagicMock(spec=AsyncSession)
    session.execute = AsyncMock(return_value=result)

    async def _override():
        yield session

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override


@pytest.mark.asyncio
async def test_seed_uri_does_not_leak_into_file_url(client: AsyncClient, app) -> None:
    _use_session(app, _make_receipt("seed://r1.jpg"))
    resp = await client.get(f"{PREFIX}/1", headers={"Authorization": f"Bearer {_admin_token()}"})
    assert resp.status_code == 200
    assert resp.json()["file_url"] is None


@pytest.mark.asyncio
async def test_s3_uri_becomes_signed_proxy_url(client: AsyncClient, app) -> None:
    _use_session(app, _make_receipt("s3://vliq-receipts/receipts/x.jpg"))
    resp = await client.get(f"{PREFIX}/1", headers={"Authorization": f"Bearer {_admin_token()}"})
    assert resp.status_code == 200
    assert resp.json()["file_url"].startswith("/api/v1/receipts/attachments/file?sig=")
