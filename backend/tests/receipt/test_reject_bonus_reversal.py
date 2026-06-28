"""Rejecting an already-APPROVED receipt must reverse the accrued bonus.

The state machine allows ``approved → rejected`` (admin cancellation, or a
stale-state race: approve in-flight → refresh → reject). Approving inserts an
``accrual_receipt`` bonus_transaction, so the cancellation has to insert a
compensating ``correction`` — otherwise the seller keeps a bonus for a rejected
receipt. Rejecting an ``on_review`` receipt (the normal path) touches no bonus.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.bonus_transaction.models import BonusTransaction, BonusTransactionKind
from src.receipt.models import Receipt, ReceiptFileKind

PREFIX = "/api/v1/receipts"


def _make_receipt(status: str, bonus_amount: int) -> Receipt:
    r = MagicMock(spec=Receipt)
    r.id = 1
    r.seller_id = 12345
    r.brand_id = 1
    r.status = status
    r.bonus_amount = bonus_amount
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


def _make_session(receipt: Receipt, *, accrued: int) -> MagicMock:
    session_mock = MagicMock(spec=AsyncSession)

    result = MagicMock()
    result.scalar_one_or_none.return_value = receipt  # FOR UPDATE receipt fetch
    result.scalar_one.return_value = accrued  # SUM(bonus_transaction.amount)

    session_mock.execute = AsyncMock(return_value=result)
    session_mock.add = MagicMock()
    session_mock.flush = AsyncMock()
    session_mock.commit = AsyncMock()

    begin_ctx = MagicMock()
    begin_ctx.__aenter__ = AsyncMock(return_value=begin_ctx)
    begin_ctx.__aexit__ = AsyncMock(return_value=False)
    session_mock.begin = MagicMock(return_value=begin_ctx)

    return session_mock


def _bonus_txns(session_mock: MagicMock) -> list[BonusTransaction]:
    return [
        call.args[0]
        for call in session_mock.add.call_args_list
        if isinstance(call.args[0], BonusTransaction)
    ]


def _use_session(app, session_mock: MagicMock) -> None:
    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override


@pytest.mark.asyncio
async def test_reject_after_approve_reverses_accrued_bonus(client: AsyncClient, app) -> None:
    receipt = _make_receipt(status="approved", bonus_amount=2000)
    session_mock = _make_session(receipt, accrued=2000)
    _use_session(app, session_mock)

    resp = await client.post(
        f"{PREFIX}/1/reject",
        json={"comment": "Отмена — чек оказался дубликатом"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"

    txns = _bonus_txns(session_mock)
    assert len(txns) == 1, "expected exactly one compensating bonus transaction"
    reversal = txns[0]
    assert reversal.amount == -2000
    assert reversal.kind == BonusTransactionKind.correction.value
    assert reversal.source_type == "receipt"
    assert reversal.source_id == 1


@pytest.mark.asyncio
async def test_reject_on_review_receipt_does_not_touch_bonus(client: AsyncClient, app) -> None:
    receipt = _make_receipt(status="on_review", bonus_amount=0)
    session_mock = _make_session(receipt, accrued=0)
    _use_session(app, session_mock)

    resp = await client.post(
        f"{PREFIX}/1/reject",
        json={"comment": "Нечитаемо"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"
    assert _bonus_txns(session_mock) == []


@pytest.mark.asyncio
async def test_revise_after_approve_also_reverses_bonus(client: AsyncClient, app) -> None:
    # revise routes to `rejected` too, so it must reverse an approved accrual as well.
    receipt = _make_receipt(status="approved", bonus_amount=1500)
    session_mock = _make_session(receipt, accrued=1500)
    _use_session(app, session_mock)

    resp = await client.post(
        f"{PREFIX}/1/revise",
        json={"comment": "Отмена"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    txns = _bonus_txns(session_mock)
    assert len(txns) == 1
    assert txns[0].amount == -1500
    assert txns[0].kind == BonusTransactionKind.correction.value
