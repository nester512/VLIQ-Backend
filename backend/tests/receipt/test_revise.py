"""Tests for POST /receipts/{id}/revise.

Stub behaviour: until the needs_revision flow is implemented, the revise
action transitions the receipt to ``rejected`` (blocked) so the seller cannot
resubmit. Happy path returns 200 and enqueues a ``receipt.rejected`` telegram
outbox row.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.notification.models import NotificationOutbox
from src.receipt.models import Receipt, ReceiptFileKind
from src.seller.models import Seller

PREFIX = "/api/v1/receipts"


def _make_receipt(receipt_id: int = 1, status: str = "on_review") -> Receipt:
    r = MagicMock(spec=Receipt)
    r.id = receipt_id
    r.seller_id = 12345
    r.brand_id = 1
    r.status = status
    r.bonus_amount = 0
    r.rejection_reason = None
    r.file_kind = ReceiptFileKind.photo
    r.file_url = "seed://r1.jpg"
    r.file_hash = "abc123"
    r.is_deleted = False
    r.created_at = datetime(2025, 1, 1, 12, 0, 0)
    r.updated_at = None
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


def _enqueued_outbox_rows(session_mock: MagicMock) -> list[NotificationOutbox]:
    return [
        call.args[0]
        for call in session_mock.add.call_args_list
        if isinstance(call.args[0], NotificationOutbox)
    ]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revise_on_review__200_and_notifies_seller(client: AsyncClient, app) -> None:
    """Admin revises an on_review receipt → 200 (no 409); stub routes to rejected,
    and a telegram notification is enqueued for the seller."""
    receipt = _make_receipt(status="on_review")
    session_mock = _make_session(receipt)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/1/revise",
        json={"comment": "Фото нечитаемо, переснимите чек"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"

    outbox_rows = _enqueued_outbox_rows(session_mock)
    assert len(outbox_rows) == 1
    row = outbox_rows[0]
    assert row.template == "receipt.rejected"
    assert row.channel == "telegram"
    assert row.recipient_id == receipt.seller_id
    assert row.payload["receipt_id"] == 1
    assert row.payload["reason"] == "Фото нечитаемо, переснимите чек"


@pytest.mark.asyncio
async def test_revise_without_comment__defaults_reason(client: AsyncClient, app) -> None:
    """Revise with no comment still succeeds and uses a default reason."""
    receipt = _make_receipt(status="on_review")
    session_mock = _make_session(receipt)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/1/revise",
        json={"comment": None},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    outbox_rows = _enqueued_outbox_rows(session_mock)
    assert len(outbox_rows) == 1
    assert outbox_rows[0].payload["reason"] == "Чек отклонён"


@pytest.mark.asyncio
async def test_revise_invalid_state__409(client: AsyncClient, app) -> None:
    """Revising a receipt that is not on_review → 409 (no spurious notification)."""
    receipt = _make_receipt(status="pending")
    session_mock = _make_session(receipt)

    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override

    resp = await client.post(
        f"{PREFIX}/1/revise",
        json={"comment": "x"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == "RECEIPT_INVALID_STATE_TRANSITION"
    assert _enqueued_outbox_rows(session_mock) == []


@pytest.mark.asyncio
async def test_revise_unauthorized__403(client: AsyncClient) -> None:
    """Seller token → 403 (admin-only endpoint)."""
    resp = await client.post(
        f"{PREFIX}/1/revise",
        json={"comment": "x"},
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )
    assert resp.status_code == 403
