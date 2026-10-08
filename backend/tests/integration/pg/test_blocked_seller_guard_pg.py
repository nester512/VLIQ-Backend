"""PG integration: the blocked-seller guard must not leave a transaction open.

The bug: ``forbid_blocked_seller`` read the seller status on the request-scoped
session, which autobegins a transaction; the upload/payout services then call
``async with session.begin()`` on the same session and fail with
"A transaction is already begun" — every seller upload returned 500. Mock-session
unit tests cannot reproduce this, hence a real database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.app.errors import AppError
from src.seller.depends import forbid_blocked_seller

from tests.integration.pg._ids import SEED_SELLER_ID

pytestmark = pytest.mark.asyncio

_SELLER_TOKEN = {"user_id": SEED_SELLER_ID, "role": "seller"}


async def test_active_seller__guard_then_service_transaction__works(session_factory: async_sessionmaker) -> None:
    async with session_factory() as session:
        assert await forbid_blocked_seller(_SELLER_TOKEN, session) is _SELLER_TOKEN

        # What the upload / payout services do next on the same session.
        async with session.begin():
            await session.execute(text("SELECT 1"))


async def test_blocked_seller__refused(session_factory: async_sessionmaker) -> None:
    async with session_factory() as s, s.begin():
        await s.execute(text("UPDATE vliq.seller SET status='blocked' WHERE telegram_id=:t"), {"t": SEED_SELLER_ID})

    async with session_factory() as session:
        with pytest.raises(AppError) as exc:
            await forbid_blocked_seller(_SELLER_TOKEN, session)

    assert exc.value.code == "SELLER_BLOCKED"


async def test_admin__no_query_no_transaction(db_session: AsyncSession) -> None:
    await forbid_blocked_seller({"user_id": 1, "role": "admin"}, db_session)

    assert not db_session.in_transaction()
