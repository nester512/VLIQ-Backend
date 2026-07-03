"""Tests for approving receipts when OCR did not produce a bonus amount."""

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


def _make_receipt(*, status: str = "on_review", bonus_amount: int = 0) -> Receipt:
    r = MagicMock(spec=Receipt)
    r.id = 1
    r.seller_id = 12345
    r.brand_id = 1
    r.status = status
    r.bonus_amount = bonus_amount
    r.rejection_reason = None
    r.rejection_code = None
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


def _make_session(receipt: Receipt) -> MagicMock:
    session_mock = MagicMock(spec=AsyncSession)

    result = MagicMock()
    result.scalar_one_or_none.return_value = receipt

    session_mock.execute = AsyncMock(return_value=result)
    session_mock.add = MagicMock()
    session_mock.flush = AsyncMock()
    session_mock.commit = AsyncMock()

    begin_ctx = MagicMock()
    begin_ctx.__aenter__ = AsyncMock(return_value=begin_ctx)
    begin_ctx.__aexit__ = AsyncMock(return_value=False)
    session_mock.begin = MagicMock(return_value=begin_ctx)

    return session_mock


def _use_session(app, session_mock: MagicMock) -> None:
    async def _override():
        yield session_mock

    from src.app.depends import get_pg_session

    app.dependency_overrides[get_pg_session] = _override


def _bonus_txns(session_mock: MagicMock) -> list[BonusTransaction]:
    return [
        call.args[0]
        for call in session_mock.add.call_args_list
        if isinstance(call.args[0], BonusTransaction)
    ]


@pytest.mark.asyncio
async def test_approve_without_any_bonus_requires_admin_amount(client: AsyncClient, app) -> None:
    receipt = _make_receipt(bonus_amount=0)
    session_mock = _make_session(receipt)
    _use_session(app, session_mock)

    resp = await client.post(
        f"{PREFIX}/1/approve",
        json={"comment": None},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 422
    assert resp.json()["code"] == "RECEIPT_BONUS_REQUIRED"
    assert _bonus_txns(session_mock) == []


@pytest.mark.asyncio
async def test_approve_with_admin_bonus_amount_accrues_that_amount(client: AsyncClient, app) -> None:
    receipt = _make_receipt(bonus_amount=0)
    session_mock = _make_session(receipt)
    _use_session(app, session_mock)

    resp = await client.post(
        f"{PREFIX}/1/approve",
        json={"comment": None, "bonus_amount": 12_300},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"

    txns = _bonus_txns(session_mock)
    assert len(txns) == 1
    assert txns[0].amount == 12_300
    assert txns[0].kind == BonusTransactionKind.accrual_receipt.value
