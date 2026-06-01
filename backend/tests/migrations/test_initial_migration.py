"""Integration tests for the initial Alembic migration.

Requires a running Postgres instance (see docker-compose in repo root).
Tests apply the migration to a fresh database, inspect schema objects, and
verify downgrade cleans up completely.

Run only with a real DB:
    POSTGRES__POSTGRES_URL=postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq \\
    poetry run pytest tests/migrations/ -q --tb=short

Skip when Postgres is not available:
    poetry run pytest tests/ -q --ignore=tests/migrations
"""
from __future__ import annotations

import os

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

POSTGRES_URL: str = os.environ.get(
    "POSTGRES__POSTGRES_URL",
    "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq",
)

# Tables expected in schema 'vliq' after upgrade.
EXPECTED_TABLES = {
    "brand",
    "admin",
    "seller",
    "sku",
    "promotion",
    "receipt",
    "bonus_transaction",
    "payout_request",
    "notification",
    "audit_log",
}

# Partial UNIQUE indexes expected on 'receipt'.
EXPECTED_PARTIAL_UNIQ = {
    "uq_receipt_fn_fd_fp",
    "uq_receipt_file_hash_active",
    "uq_receipt_qr_raw_active",
}

# GIN indexes expected.
EXPECTED_GIN_INDEXES = {
    "ix_sku_aliases_gin",
    "ix_receipt_items_gin",
    "ix_receipt_fraud_signals_gin",
}

# Enum types expected in schema 'vliq'.
EXPECTED_ENUMS = {
    "admin_role_enum",
    "seller_status_enum",
    "payout_kind_enum",
    "receipt_status_enum",
    "receipt_file_kind_enum",
    "promotion_status_enum",
    "bonus_transaction_kind_enum",
    "payout_request_status_enum",
    "notification_type_enum",
    "notification_delivery_status_enum",
    "audit_log_actor_type_enum",
}


@pytest_asyncio.fixture()
async def pg_engine():
    """Async engine for inspecting the test database."""
    engine = create_async_engine(POSTGRES_URL, echo=False, future=True)
    yield engine
    await engine.dispose()


async def _run_alembic(command: str) -> None:
    """Run alembic upgrade/downgrade programmatically."""
    import subprocess
    env = {**os.environ, "POSTGRES__POSTGRES_URL": POSTGRES_URL}
    result = subprocess.run(
        ["poetry", "run", "alembic", "-c", "alembic.ini"] + command.split(),
        cwd="/Users/kexibo/VLIQ-BOT/backend",
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic {command} failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        )


@pytest.fixture(scope="module", autouse=True)
def apply_migration():
    """Ensure migration is applied before tests and cleaned up after."""
    # Downgrade to clean state, then upgrade fresh.
    _run_alembic_sync()

    yield

    # Downgrade after tests to leave DB clean.
    import subprocess
    subprocess.run(
        ["poetry", "run", "alembic", "-c", "alembic.ini", "downgrade", "base"],
        cwd="/Users/kexibo/VLIQ-BOT/backend",
        capture_output=True,
        env={**os.environ, "POSTGRES__POSTGRES_URL": POSTGRES_URL},
        timeout=60,
    )


def _run_alembic_sync():
    import subprocess
    # First downgrade to ensure clean state.
    subprocess.run(
        ["poetry", "run", "alembic", "-c", "alembic.ini", "downgrade", "base"],
        cwd="/Users/kexibo/VLIQ-BOT/backend",
        capture_output=True,
        env={**os.environ, "POSTGRES__POSTGRES_URL": POSTGRES_URL},
        timeout=60,
    )
    # Then upgrade to head.
    result = subprocess.run(
        ["poetry", "run", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd="/Users/kexibo/VLIQ-BOT/backend",
        capture_output=True,
        text=True,
        env={**os.environ, "POSTGRES__POSTGRES_URL": POSTGRES_URL},
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
        )


@pytest.mark.asyncio
async def test_migration__all_10_tables_exist(pg_engine):
    """All 10 domain tables must be present in the vliq schema."""
    async with pg_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'vliq' AND table_type = 'BASE TABLE'"
            )
        )
        tables = {row[0] for row in result}

    assert EXPECTED_TABLES.issubset(tables), (
        f"Missing tables: {EXPECTED_TABLES - tables}"
    )


@pytest.mark.asyncio
async def test_migration__partial_unique_indexes_exist(pg_engine):
    """Partial UNIQUE indexes B7/B8 must be present in pg_indexes."""
    async with pg_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'vliq' AND tablename = 'receipt'"
            )
        )
        index_names = {row[0] for row in result}

    assert EXPECTED_PARTIAL_UNIQ.issubset(index_names), (
        f"Missing partial UNIQUE indexes: {EXPECTED_PARTIAL_UNIQ - index_names}"
    )


@pytest.mark.asyncio
async def test_migration__gin_indexes_exist(pg_engine):
    """GIN indexes (H9) must exist and use USING gin."""
    async with pg_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname = 'vliq' AND indexdef ILIKE '%USING gin%'"
            )
        )
        gin_index_names = {row[0] for row in result}

    assert EXPECTED_GIN_INDEXES.issubset(gin_index_names), (
        f"Missing GIN indexes: {EXPECTED_GIN_INDEXES - gin_index_names}"
    )


@pytest.mark.asyncio
async def test_migration__enum_types_exist(pg_engine):
    """All enum types must be created in the vliq schema."""
    async with pg_engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT typname FROM pg_type "
                "JOIN pg_namespace ON pg_namespace.oid = pg_type.typnamespace "
                "WHERE pg_namespace.nspname = 'vliq' AND pg_type.typtype = 'e'"
            )
        )
        enum_names = {row[0] for row in result}

    assert EXPECTED_ENUMS.issubset(enum_names), (
        f"Missing enum types: {EXPECTED_ENUMS - enum_names}"
    )


@pytest.mark.asyncio
async def test_migration__downgrade_cleans_schema():
    """After downgrade base, the vliq schema must be absent."""
    import subprocess

    result = subprocess.run(
        ["poetry", "run", "alembic", "-c", "alembic.ini", "downgrade", "base"],
        cwd="/Users/kexibo/VLIQ-BOT/backend",
        capture_output=True,
        text=True,
        env={**os.environ, "POSTGRES__POSTGRES_URL": POSTGRES_URL},
        timeout=60,
    )
    assert result.returncode == 0, f"downgrade base failed:\n{result.stderr}"

    engine = create_async_engine(POSTGRES_URL, echo=False, future=True)
    try:
        async with engine.connect() as conn:
            result_q = await conn.execute(
                text(
                    "SELECT schema_name FROM information_schema.schemata "
                    "WHERE schema_name = 'vliq'"
                )
            )
            rows = result_q.fetchall()
        # After DROP SCHEMA IF EXISTS vliq CASCADE, schema must be gone.
        assert len(rows) == 0, "vliq schema still exists after downgrade base"
    finally:
        await engine.dispose()
