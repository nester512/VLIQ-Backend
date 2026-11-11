"""PG integration: a still-valid token stops working the moment the account changes.

A token lives 6 days. Before the fix the server trusted it as issued: a switched-off admin
kept approving receipts and paying out, a demoted super admin kept super-admin rights, a
blocked seller kept seeing his data. Now every request re-checks the account in the database.
"""

from __future__ import annotations

import pytest
from jose import jwt
from sqlalchemy import text
from src.app.auth.jwt import check_account_access, jwt_auth
from src.app.errors import AppError
from src.auth.handlers.api.v1.router import _issue_token_for_telegram_id

from tests.integration.pg._ids import SEED_SELLER_ID

pytestmark = pytest.mark.asyncio
ADMIN = 990901  # an id no other PG test uses


async def _token(sm, telegram_id: int) -> dict:
    async with sm() as s:
        issued = await _issue_token_for_telegram_id(telegram_id, s)
    return jwt.decode(issued.access_token, jwt_auth.secret, algorithms=[jwt_auth.algorithm])


async def _sql(sm, sql: str, **params) -> None:
    async with sm() as s, s.begin():
        await s.execute(text(sql), params)


async def _check(sm, token: dict) -> None:
    async with sm() as s:
        await check_account_access(token, s)
        assert not s.in_transaction()  # the handler can still open its own transaction


@pytest.fixture
async def admin(session_factory):
    await _sql(
        session_factory,
        "INSERT INTO vliq.admin (telegram_id, phone_e164, role, brand_ids, is_active, created_at, updated_at) "
        "VALUES (:t, '+99990901', 'super_admin', '[]'::jsonb, true, now(), now()) "
        "ON CONFLICT (telegram_id) DO UPDATE SET is_active = true, role = 'super_admin'",
        t=ADMIN,
    )
    yield ADMIN
    await _sql(session_factory, "DELETE FROM vliq.admin WHERE telegram_id = :t", t=ADMIN)


async def test_admin_switched_off__old_token_refused__login_refused(session_factory, admin) -> None:
    sm = session_factory
    token = await _token(sm, admin)
    await _check(sm, token)  # works while active

    await _sql(sm, "UPDATE vliq.admin SET is_active = false WHERE telegram_id = :t", t=admin)

    with pytest.raises(AppError) as err:
        await _check(sm, token)
    assert (err.value.code, err.value.status_code) == ("ADMIN_DISABLED", 403)
    with pytest.raises(AppError) as err:
        await _token(sm, admin)
    assert err.value.code == "ADMIN_DISABLED"


async def test_super_admin_demoted__old_token_must_log_in_again(session_factory, admin) -> None:
    sm = session_factory
    token = await _token(sm, admin)
    assert token["role"] == "super_admin"

    await _sql(sm, "UPDATE vliq.admin SET role = 'admin' WHERE telegram_id = :t", t=admin)

    with pytest.raises(AppError) as err:
        await _check(sm, token)
    assert (err.value.code, err.value.status_code) == ("AUTH_TOKEN_STALE", 401)
    fresh = await _token(sm, admin)
    assert fresh["role"] == "admin"
    await _check(sm, fresh)


async def test_admin_removed__old_token_must_log_in_again(session_factory, admin) -> None:
    sm = session_factory
    token = await _token(sm, admin)

    await _sql(sm, "DELETE FROM vliq.admin WHERE telegram_id = :t", t=admin)

    with pytest.raises(AppError) as err:
        await _check(sm, token)
    assert err.value.code == "AUTH_TOKEN_STALE"


async def test_seller_blocked__old_token_refused__unblocked__works_again(session_factory) -> None:
    sm = session_factory
    token = await _token(sm, SEED_SELLER_ID)

    await _sql(sm, "UPDATE vliq.seller SET status = 'blocked' WHERE telegram_id = :t", t=SEED_SELLER_ID)
    with pytest.raises(AppError) as err:
        await _check(sm, token)
    assert (err.value.code, err.value.status_code) == ("SELLER_BLOCKED", 403)

    await _sql(sm, "UPDATE vliq.seller SET status = 'active' WHERE telegram_id = :t", t=SEED_SELLER_ID)
    await _check(sm, token)
