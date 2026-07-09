"""Tests for PATCH /payout-requests/{id} (KAN-22).

Admin edits a pending payout: amount changes adjust the balance hold with a
delta ``payout_hold`` transaction and enqueue a ``payout.amount_changed``
notification for the seller.
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.app.auth.jwt import jwt_auth
from src.bonus_transaction.models import BonusTransaction
from src.notification.models import NotificationOutbox
from src.payout_request.models import PayoutRequest
from src.seller.models import Seller

PREFIX = "/api/v1/payout-requests"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_payout(payout_id: int = 1, status: str = "new", amount: int = 235000) -> PayoutRequest:
    p = MagicMock(spec=PayoutRequest)
    p.id = payout_id
    p.seller_id = 12345
    p.brand_id = 1
    p.amount = amount
    p.payout_kind = "sbp_phone"
    p.payout_masked = "•••• 4117"
    p.status = status
    p.admin_comment = None
    p.external_txn_id = None
    p.created_at = datetime(2025, 1, 1, 12, 0, 0)
    p.updated_at = None
    p.created_by = None
    p.updated_by = None
    return p


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


def _lock_result(obj) -> MagicMock:
    res = MagicMock()
    res.scalar_one_or_none.return_value = obj
    return res


def _balance_result(*, available_accruals: int, payout_hold: int) -> MagicMock:
    row = MagicMock()
    row.available_accruals = available_accruals
    row.payout_hold = payout_hold
    row.total_accrued = available_accruals
    row.payout_completed = 0
    res = MagicMock()
    res.one.return_value = row
    return res


def _make_session(*execute_results: MagicMock) -> MagicMock:
    session_mock = MagicMock(spec=AsyncSession)
    session_mock.execute = AsyncMock(side_effect=list(execute_results))
    session_mock.flush = AsyncMock()
    session_mock.refresh = AsyncMock()
    session_mock.add = MagicMock()
    session_mock.commit = AsyncMock()

    begin_ctx = MagicMock()
    begin_ctx.__aenter__ = AsyncMock(return_value=begin_ctx)
    begin_ctx.__aexit__ = AsyncMock(return_value=False)
    session_mock.begin = MagicMock(return_value=begin_ctx)

    return session_mock


def _override_session(app, session_mock: MagicMock) -> None:
    from src.app.depends import get_pg_session

    async def _override():
        yield session_mock

    app.dependency_overrides[get_pg_session] = _override


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_decrease_amount_releases_hold_and_notifies(client: AsyncClient, app) -> None:
    """Amount 2350₽ → 2000₽: +350₽ hold release and seller notification."""
    payout = _make_payout(status="new", amount=235000)
    session_mock = _make_session(_lock_result(payout))
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/1",
        json={"amount": 200000},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    assert payout.amount == 200000
    added = [call.args[0] for call in session_mock.add.call_args_list]
    holds = [x for x in added if isinstance(x, BonusTransaction)]
    outbox_rows = [x for x in added if isinstance(x, NotificationOutbox)]
    assert len(holds) == 1
    assert holds[0].amount == 35000  # positive — partial hold release
    assert holds[0].kind == "payout_hold"
    assert holds[0].source_id == 1
    assert len(outbox_rows) == 1
    assert outbox_rows[0].recipient_id == 12345
    assert outbox_rows[0].template == "payout.amount_changed"
    assert outbox_rows[0].payload == {
        "amount": 200000,
        "old_amount": 235000,
        "payout_masked": "•••• 4117",
    }


@pytest.mark.asyncio
async def test_increase_amount_checks_balance_and_holds_extra(client: AsyncClient, app) -> None:
    """Amount 2350₽ → 3000₽ with enough balance: -650₽ extra hold, notification sent."""
    payout = _make_payout(status="in_progress", amount=235000)
    seller = MagicMock(spec=Seller)
    session_mock = _make_session(
        _lock_result(payout),
        _lock_result(seller),
        # accruals 10 000₽, hold -2350₽ → available 7650₽ >= delta 650₽
        _balance_result(available_accruals=1000000, payout_hold=-235000),
    )
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/1",
        json={"amount": 300000},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    assert payout.amount == 300000
    added = [call.args[0] for call in session_mock.add.call_args_list]
    holds = [x for x in added if isinstance(x, BonusTransaction)]
    outbox_rows = [x for x in added if isinstance(x, NotificationOutbox)]
    assert len(holds) == 1
    assert holds[0].amount == -65000  # negative — extra hold for the increase
    assert len(outbox_rows) == 1
    assert outbox_rows[0].payload["amount"] == 300000
    assert outbox_rows[0].payload["old_amount"] == 235000


@pytest.mark.asyncio
async def test_increase_amount_insufficient_balance_422(client: AsyncClient, app) -> None:
    """Delta exceeds available balance → 422, nothing written."""
    payout = _make_payout(status="new", amount=235000)
    seller = MagicMock(spec=Seller)
    session_mock = _make_session(
        _lock_result(payout),
        _lock_result(seller),
        # accruals 2500₽, hold -2350₽ → available 150₽ < delta 650₽
        _balance_result(available_accruals=250000, payout_hold=-235000),
    )
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/1",
        json={"amount": 300000},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 422
    assert resp.json()["code"] == "PAYOUT_INSUFFICIENT_BALANCE"
    added = [call.args[0] for call in session_mock.add.call_args_list]
    assert not [x for x in added if isinstance(x, BonusTransaction | NotificationOutbox)]


@pytest.mark.asyncio
async def test_comment_only_no_hold_no_notification(client: AsyncClient, app) -> None:
    """Comment-only edit: no ledger writes, no notification."""
    payout = _make_payout(status="new", amount=235000)
    session_mock = _make_session(_lock_result(payout))
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/1",
        json={"admin_comment": "созвонились, ок"},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    assert payout.admin_comment == "созвонились, ок"
    added = [call.args[0] for call in session_mock.add.call_args_list]
    assert not [x for x in added if isinstance(x, BonusTransaction | NotificationOutbox)]


@pytest.mark.asyncio
async def test_same_amount_is_noop(client: AsyncClient, app) -> None:
    """Same amount → 200, but no hold delta and no notification."""
    payout = _make_payout(status="new", amount=235000)
    session_mock = _make_session(_lock_result(payout))
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/1",
        json={"amount": 235000},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 200
    added = [call.args[0] for call in session_mock.add.call_args_list]
    assert not [x for x in added if isinstance(x, BonusTransaction | NotificationOutbox)]


@pytest.mark.asyncio
async def test_terminal_status_409(client: AsyncClient, app) -> None:
    """Editing a paid payout → 409 PAYOUT_INVALID_STATE."""
    payout = _make_payout(status="paid", amount=235000)
    session_mock = _make_session(_lock_result(payout))
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/1",
        json={"amount": 100000},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 409
    assert resp.json()["code"] == "PAYOUT_INVALID_STATE"


@pytest.mark.asyncio
async def test_not_found_404(client: AsyncClient, app) -> None:
    session_mock = _make_session(_lock_result(None))
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/777",
        json={"amount": 100000},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )

    assert resp.status_code == 404
    assert resp.json()["code"] == "PAYOUT_NOT_FOUND"


@pytest.mark.asyncio
async def test_seller_forbidden_403(client: AsyncClient) -> None:
    """Seller token → 403 (admin-only endpoint)."""
    resp = await client.patch(
        f"{PREFIX}/1",
        json={"amount": 100000},
        headers={"Authorization": f"Bearer {_seller_token()}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_invalid_amount_422(client: AsyncClient, app) -> None:
    """amount <= 0 is rejected by schema validation."""
    payout = _make_payout(status="new", amount=235000)
    session_mock = _make_session(_lock_result(payout))
    _override_session(app, session_mock)

    resp = await client.patch(
        f"{PREFIX}/1",
        json={"amount": 0},
        headers={"Authorization": f"Bearer {_admin_token()}"},
    )
    assert resp.status_code == 422
