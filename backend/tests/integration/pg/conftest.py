"""Real-PostgreSQL integration fixtures.

These tests run against a real ``vliq_test`` database with a real
``AsyncSession`` — NOT a MagicMock — so genuine transaction boundaries
(``autobegin``, ``session.begin()``, commit/rollback) are exercised. They exist
because mock-session unit tests cannot reproduce "A transaction is already begun".

Run only with a DB (the standard suite ignores ``tests/integration``):
    TEST_PG_URL=postgresql+asyncpg://vliq:vliq_dev@postgres:5432/vliq_test \\
    pytest tests/integration/pg -q

The schema is migrated once via Alembic (real 0001..head); each test truncates
the receipt-related tables for isolation. ALL ORM models are imported so
cross-table foreign keys (Receipt.seller_id → Seller, …) resolve.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
from collections.abc import AsyncGenerator
from pathlib import Path

import pytest
import pytest_asyncio

# Import every model so SQLAlchemy can resolve FK relationships (mirrors arq_worker).
import src.admin.models  # noqa: F401
import src.audit_log.models  # noqa: F401
import src.bonus_transaction.models  # noqa: F401
import src.brand.models  # noqa: F401
import src.city.models  # noqa: F401
import src.notification.models  # noqa: F401
import src.payout_request.models  # noqa: F401
import src.promotion.models  # noqa: F401
import src.receipt.models  # noqa: F401
import src.seller.models  # noqa: F401
import src.sku.models  # noqa: F401
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

PG_URL = os.environ.get(
    "POSTGRES__POSTGRES_URL",
    "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test",
)
_BACKEND_ROOT = str(Path(__file__).resolve().parents[3])

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID  # noqa: E402

_TRUNCATE = (
    "TRUNCATE vliq.receipt_attachment, vliq.receipt, vliq.notification_outbox, "
    "vliq.bonus_transaction RESTART IDENTITY CASCADE"
)


def _alembic(*args: str) -> None:
    result = subprocess.run(
        ["alembic", "-c", "alembic.ini", *args],
        check=False,
        cwd=_BACKEND_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, "POSTGRES__POSTGRES_URL": PG_URL},
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {args} failed:\n{result.stdout}\n{result.stderr}")


async def _reset_schema() -> None:
    """Drop the vliq schema + alembic version directly (a plain ``downgrade base``
    can fail re-creating UNIQUE indexes on leftover duplicate rows from a prior run)."""
    engine = create_async_engine(PG_URL, echo=False)
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP SCHEMA IF EXISTS vliq CASCADE"))
            await conn.execute(text("DROP TABLE IF EXISTS public.alembic_version"))
    finally:
        await engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def _pg_schema() -> None:
    """Reset + migrate vliq_test to head once for the whole PG test session."""
    asyncio.run(_reset_schema())
    _alembic("upgrade", "head")


@pytest_asyncio.fixture
async def session_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    """A real async_sessionmaker bound to vliq_test.

    Truncates receipt tables and (re)seeds a brand + seller before each test so a
    test can open fresh sessions per logical operation (mimicking API + worker
    each owning their own session).
    """
    engine = create_async_engine(PG_URL, echo=False, future=True)
    sm = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with sm() as s, s.begin():
        await s.execute(text(_TRUNCATE))
        await s.execute(
            text(
                "INSERT INTO vliq.brand (id, name, slug, is_active, created_at) "
                "VALUES (:id,'B','b',true,now()) ON CONFLICT (id) DO NOTHING"
            ),
            {"id": SEED_BRAND_ID},
        )
        await s.execute(
            text(
                "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) "
                "VALUES (:tid,:bid,'+79990000001','active',now()) "
                "ON CONFLICT (telegram_id) DO UPDATE SET status='active'"
            ),
            {"tid": SEED_SELLER_ID, "bid": SEED_BRAND_ID},
        )
    try:
        yield sm
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def db_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncGenerator[AsyncSession, None]:
    """A single real session for direct assertions/seeding."""
    async with session_factory() as session:
        yield session
