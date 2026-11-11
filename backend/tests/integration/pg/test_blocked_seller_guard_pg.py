"""PG integration: the blocked-seller guard must not leave a transaction open.

The bug: the guard (then ``forbid_blocked_seller``, now ``check_account_access``) read
the seller status on the request-scoped session, which autobegins a transaction; the
upload/payout services then call ``async with session.begin()`` on the same session and fail with
"A transaction is already begun" — every seller upload returned 500. Mock-session
unit tests cannot reproduce this, hence a real database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker
from src.app.auth.jwt import check_account_access
from src.app.errors import AppError

from tests.integration.pg._ids import SEED_SELLER_ID

pytestmark = pytest.mark.asyncio

_SELLER_TOKEN = {"user_id": SEED_SELLER_ID, "role": "seller"}


async def test_active_seller__guard_then_service_transaction__works(session_factory: async_sessionmaker) -> None:
    async with session_factory() as session:
        assert await check_account_access(_SELLER_TOKEN, session) is None

        # What the upload / payout services do next on the same session.
        async with session.begin():
            await session.execute(text("SELECT 1"))


async def test_blocked_seller__refused(session_factory: async_sessionmaker) -> None:
    async with session_factory() as s, s.begin():
        await s.execute(text("UPDATE vliq.seller SET status='blocked' WHERE telegram_id=:t"), {"t": SEED_SELLER_ID})

    async with session_factory() as session:
        with pytest.raises(AppError) as exc:
            await check_account_access(_SELLER_TOKEN, session)

    assert exc.value.code == "SELLER_BLOCKED"
