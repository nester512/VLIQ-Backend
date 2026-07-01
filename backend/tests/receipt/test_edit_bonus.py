"""Tests for PATCH /receipts/{id}/bonus (T3)."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.bonus_transaction.models import BonusTransaction
from src.notification.models import NotificationOutbox
from src.receipt.models import Receipt, ReceiptFileKind
from src.seller.models import Seller

PREFIX = "/api/v1/receipts"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_receipt(receipt_id: int = 1, status: str = "on_review", bonus_amount: int = 100) -> Receipt:
    r = MagicMock(spec=Receipt)
    r.id = receipt_id
    r.seller_id = 12345
    r.brand_id = 1
    r.status = status
    r.bonus_amount = bonus_amount
    r.rejection_reason = None
    r.rejection_code = None
    r.file_kind = ReceiptFileKind.photo
    r.file_url = "seed://r1.jpg"
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


def _seller_token() -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = 55555
    return jwt_auth.create_token(seller)


def _make_session(receipt: Receipt | None) -> MagicMock:
    session_mock = MagicMock(spec=AsyncSession)

    lock_result = MagicMock()
    lock_result.scalar_one_or_none.return_value = receipt

    session_mock.execute = AsyncMock(return_value=lock_result)
    session_mock.flush = AsyncMock()
    session_mock.refresh = AsyncMock()
    session_mock.add = MagicMock()
    session_mock.commit = AsyncMock()

    begin_ctx = MagicMock()
    begin_ctx.__aenter__ = AsyncMock(return_value=begin_ctx)
    begin_ctx.__aexit__ = AsyncMock(return_value=False)
    session_mock.begin = MagicMock(return_value=begin_ctx)

    return session_mock


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_on_review(client: AsyncClient, app) -> None:
    """Admin edits bonus on on_review receipt → 200."""
    receipt = _make_receipt(status="on_review", bonus_amount=100)
    session_mock = _make_session(receipt)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.patch(
        f"{PREFIX}/1/bonus",
        json={"bonus_amount": 200},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_valid_approved_creates_correction(client: AsyncClient, app) -> None:
    """Admin edits bonus on approved receipt → correction and seller notification are recorded."""
    receipt = _make_receipt(status="approved", bonus_amount=100)
    session_mock = _make_session(receipt)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.patch(
        f"{PREFIX}/1/bonus",
        json={"bonus_amount": 250},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    added = [call.args[0] for call in session_mock.add.call_args_list]
    corrections = [x for x in added if isinstance(x, BonusTransaction)]
    outbox_rows = [x for x in added if isinstance(x, NotificationOutbox)]
    assert len(corrections) == 1
    assert corrections[0].amount == 150
    assert len(outbox_rows) == 1
    assert outbox_rows[0].recipient_id == receipt.seller_id
    assert outbox_rows[0].template == "receipt.bonus_changed"
    assert outbox_rows[0].payload == {"receipt_id": 1, "bonus_amount": 250}


@pytest.mark.asyncio
async def test_invalid_state_409(client: AsyncClient, app) -> None:
    """Editing bonus on pending/rejected receipt → 409."""
    receipt = _make_receipt(status="rejected", bonus_amount=0)
    session_mock = _make_session(receipt)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.patch(
        f"{PREFIX}/1/bonus",
        json={"bonus_amount": 100},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == "RECEIPT_INVALID_STATE_TRANSITION"


@pytest.mark.asyncio
async def test_unauthorized_403(client: AsyncClient) -> None:
    """Seller token → 403 (admin-only endpoint)."""
    resp = await client.patch(
        f"{PREFIX}/1/bonus",
        json={"bonus_amount": 100},
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )
    assert resp.status_code == 403
