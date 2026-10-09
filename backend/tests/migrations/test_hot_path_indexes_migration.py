"""Migration 0010_hot_path_indexes — production-safety behaviour on real PostgreSQL.

- new indexes exist and are VALID, redundant ones are gone;
- no row is lost or changed by the migration (indexes only);
- the planner can serve the hot queries from the new indexes;
- an INVALID leftover of an interrupted CONCURRENTLY build is rebuilt;
- downgrade restores the previous index set.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

POSTGRES_URL: str = os.environ.get("POSTGRES__POSTGRES_URL", "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test")
_BACKEND_ROOT = str(Path(__file__).resolve().parents[2])

NEW = ["ix_receipt_live_status_created", "ix_receipt_live_created", "ix_receipt_live_seller_created", "ix_notification_seller_created"]
DROPPED = [
    "vliq_receipt_is_deleted_idx",
    "vliq_seller_phone_e164_idx",
    "vliq_bonus_transaction_seller_id_idx",
    "vliq_payout_request_seller_id_idx",
    "ix_receipt_verification_attempt_receipt_id",
]

_SEED = [
    "INSERT INTO vliq.brand (id, name, slug, is_active, created_at) VALUES (1,'B','b',true,now()) ON CONFLICT DO NOTHING",
    "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) VALUES (1,1,'+70000000001','active',now())",
    # 300 receipts across statuses, some soft-deleted
    """INSERT INTO vliq.receipt (seller_id, brand_id, status, bonus_amount, items, fraud_signals, admin_comments,
                                is_deleted, created_at, total_sum)
       SELECT 1, 1, (ARRAY['on_review','approved','rejected','paid_out'])[1 + g % 4]::vliq.receipt_status_enum, g,
              '[]', '[]', '[]', g % 10 = 0, now() - (g || ' minutes')::interval, g * 100
       FROM generate_series(1, 300) g""",
]

# Explicit business columns: later migrations ADD columns, which must not count as «data changed».
_FINGERPRINT = (
    "SELECT count(*), sum(hashtext(concat_ws('|', id, seller_id, brand_id, status, bonus_amount, total_sum, "
    "is_deleted, created_at))::bigint) FROM vliq.receipt"
)


def _alembic(*args: str) -> None:
    result = subprocess.run(
        ["alembic", "-c", "alembic.ini", *args], check=False, cwd=_BACKEND_ROOT, capture_output=True, text=True,
        env={**os.environ, "POSTGRES__POSTGRES_URL": POSTGRES_URL}, timeout=180,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {args} failed:\n{result.stdout}\n{result.stderr}")


async def _sql(*statements: str) -> list:
    engine = create_async_engine(POSTGRES_URL)
    rows: list = []
    try:
        async with engine.begin() as conn:
            for stmt in statements:
                res = await conn.execute(text(stmt))
                rows = list(res) if res.returns_rows else rows
    finally:
        await engine.dispose()
    return rows


def sql(*statements: str) -> list:
    return asyncio.run(_sql(*statements))


def indexes() -> dict[str, bool]:
    """index name → is valid, for the vliq schema."""
    rows = sql(
        "SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
        "JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vliq'"
    )
    return {name: valid for name, valid in rows}


@pytest.fixture(scope="module")
def at_0009_with_data():
    _alembic("downgrade", "base")
    _alembic("upgrade", "0009_qr_intake")
    sql(*_SEED)
    fingerprint = sql(_FINGERPRINT)[0]
    yield fingerprint
    # File-less rows cannot go below 0005 (legacy NOT NULL file_kind) — clean first.
    sql("DELETE FROM vliq.receipt", "DELETE FROM vliq.seller")
    _alembic("downgrade", "base")


@pytest.fixture(scope="module")
def migrated(at_0009_with_data):
    _alembic("upgrade", "0010_hot_path_indexes")
    return at_0009_with_data


def test_new_indexes_valid_and_redundant_gone(migrated) -> None:
    idx = indexes()
    for name in NEW:
        assert idx.get(name) is True, name
    for name in DROPPED:
        assert name not in idx, name


def test_no_data_lost_or_changed(migrated) -> None:
    assert sql(_FINGERPRINT)[0] == migrated


def test_planner_serves_hot_queries_from_new_indexes(migrated) -> None:
    def plan(query: str) -> str:
        rows = sql("SET enable_seqscan = off", "SET enable_bitmapscan = off", f"EXPLAIN {query}")
        return "\n".join(r[0] for r in rows)

    assert "ix_receipt_live_status_created" in plan(
        "SELECT * FROM vliq.receipt WHERE status = 'on_review' AND is_deleted = false ORDER BY created_at, id LIMIT 20"
    )
    assert "ix_receipt_live_seller_created" in plan(
        "SELECT * FROM vliq.receipt WHERE seller_id = 1 AND is_deleted = false ORDER BY created_at DESC, id DESC LIMIT 30"
    )
    assert "ix_receipt_live_created" in plan(
        "SELECT * FROM vliq.receipt WHERE is_deleted = false ORDER BY created_at DESC, id DESC LIMIT 100"
    )


def test_rerun_is_idempotent_and_rebuilds_an_invalid_leftover(migrated) -> None:
    _alembic("downgrade", "0009_qr_intake")
    # Simulate an interrupted CREATE INDEX CONCURRENTLY: same name, wrong shape, INVALID.
    sql(
        "CREATE INDEX ix_receipt_live_created ON vliq.receipt (id)",
        "UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'vliq.ix_receipt_live_created'::regclass",
    )
    assert indexes()["ix_receipt_live_created"] is False

    _alembic("upgrade", "0010_hot_path_indexes")
    _alembic("upgrade", "head")  # no-op re-run must not fail

    assert indexes()["ix_receipt_live_created"] is True
    definition = sql("SELECT pg_get_indexdef('vliq.ix_receipt_live_created'::regclass)")[0][0]
    assert "created_at DESC" in definition
    assert sql(_FINGERPRINT)[0] == migrated


def test_downgrade_restores_previous_indexes(migrated) -> None:
    _alembic("downgrade", "0009_qr_intake")
    idx = indexes()
    for name in DROPPED:
        assert idx.get(name) is True, name
    for name in NEW:
        assert name not in idx, name
    assert sql(_FINGERPRINT)[0] == migrated
    _alembic("upgrade", "head")
