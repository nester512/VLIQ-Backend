"""Every request re-checks the account, not only the login (UC-OP1, UC-OP2, «Блокировка продавца»).

The bug: a token lives 6 days and the server trusted it as issued — a switched-off admin could
still approve receipts and pay out, a blocked seller could still see balance and receipts.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.admin.models import Admin
from src.app.auth.jwt import account_access_dependency, check_account_access, jwt_auth
from src.app.depends import get_pg_session
from src.app.errors import AppError
from src.seller.models import Seller, SellerStatus

ADMIN_ID = 70000099
SELLER_ID = 70000001

pytestmark = pytest.mark.asyncio


def _admin_token(role: str = "admin") -> str:
    admin = MagicMock(spec=Admin)
    admin.telegram_id, admin.role = ADMIN_ID, role
    return jwt_auth.create_token(admin)


def _seller_token() -> str:
    seller = MagicMock(spec=Seller)
    seller.telegram_id = SELLER_ID
    return jwt_auth.create_token(seller)


def _admin_session(row: tuple[bool, str] | None) -> MagicMock:
    """The account check reads (is_active, role); the handler must never run."""
    result = MagicMock()
    result.first.return_value = row
    session = MagicMock(spec=AsyncSession)
    session.execute = AsyncMock(side_effect=[result, AssertionError("handler must not run")])
    session.scalar = AsyncMock(side_effect=AssertionError("handler must not run"))
    return session


def _seller_session(status: str) -> MagicMock:
    session = MagicMock(spec=AsyncSession)
    session.scalar = AsyncMock(side_effect=[status, False, AssertionError("handler must not run")])
    session.execute = AsyncMock(side_effect=AssertionError("handler must not run"))
    return session


def _use(app, session: MagicMock) -> None:
    async def _dep():
        yield session

    app.dependency_overrides[get_pg_session] = _dep
    app.dependency_overrides.pop(account_access_dependency, None)  # the real re-check


# --- a switched-off admin with a still-valid token ------------------------------------------

ADMIN_ROUTES = [
    ("post", "/api/v1/receipts/1/approve", {"json": {"bonus_amount": "100"}}),
    ("post", "/api/v1/receipts/1/reject", {"json": {"reason": "не тот чек"}}),
    ("post", "/api/v1/payout-requests/1/approve", {"json": {}}),
    ("post", f"/api/v1/sellers/{SELLER_ID}/block", {"json": {}}),
    ("get", "/api/v1/analytics/dashboard", {}),
]


@pytest.mark.parametrize(("method", "path", "kwargs"), ADMIN_ROUTES)
async def test_disabled_admin__old_token__refused(client: AsyncClient, app, method, path, kwargs):
    _use(app, _admin_session((False, "admin")))

    response = await getattr(client, method)(path, headers={"Authorization": f"Bearer {_admin_token()}"}, **kwargs)

    assert response.status_code == 403
    assert response.json()["code"] == "ADMIN_DISABLED"


@pytest.mark.parametrize(("method", "path", "kwargs"), ADMIN_ROUTES)
async def test_removed_admin__old_token__must_log_in_again(client: AsyncClient, app, method, path, kwargs):
    _use(app, _admin_session(None))

    response = await getattr(client, method)(path, headers={"Authorization": f"Bearer {_admin_token()}"}, **kwargs)

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_TOKEN_STALE"


async def test_demoted_super_admin__old_token__must_log_in_again(client: AsyncClient, app):
    """super_admin → admin: the old super_admin token must not keep super-admin rights."""
    _use(app, _admin_session((True, "admin")))

    response = await client.post(
        f"/api/v1/sellers/{SELLER_ID}/transfer-login",
        json={"new_telegram_id": 70000777, "reason": "проверено по видеозвонку"},
        headers={"Authorization": f"Bearer {_admin_token('super_admin')}"},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "AUTH_TOKEN_STALE"


@pytest.mark.parametrize("role", ["admin", "super_admin"])
async def test_active_admin__same_role__passes(role: str):
    session = _admin_session((True, role))

    assert await check_account_access({"user_id": ADMIN_ID, "role": role}, session) is None


# --- a blocked seller with a still-valid token: viewing is refused too (decision В-1) -------

SELLER_READS = [
    "/api/v1/sellers/me",
    "/api/v1/sellers/me/balance",
    "/api/v1/sellers/me/receipts",
    "/api/v1/payout-requests/me",
]


@pytest.mark.parametrize("path", SELLER_READS)
async def test_blocked_seller__old_token__cannot_view(client: AsyncClient, app, path):
    _use(app, _seller_session(SellerStatus.blocked.value))

    response = await client.get(path, headers={"Authorization": f"Bearer {_seller_token()}"})

    assert response.status_code == 403
    assert response.json()["code"] == "SELLER_BLOCKED"


async def test_check__reads_and_ends_its_transaction():
    session = _admin_session((True, "admin"))
    session.in_transaction = MagicMock(return_value=False)

    await check_account_access({"user_id": ADMIN_ID, "role": "admin"}, session)

    session.rollback.assert_awaited_once()


async def test_check__disabled_admin__error_code():
    with pytest.raises(AppError) as exc:
        await check_account_access({"user_id": ADMIN_ID, "role": "admin"}, _admin_session((False, "admin")))
    assert (exc.value.code, exc.value.status_code) == ("ADMIN_DISABLED", 403)
