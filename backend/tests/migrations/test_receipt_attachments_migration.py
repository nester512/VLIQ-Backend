"""Migration-behavior tests for 0005_receipt_attachments.

Requires a running Postgres (separate vliq_test DB recommended). Verifies:
- file-based receipts get exactly one backfilled attachment at position 0;
- a QR-only receipt (``qr://inline`` / file_kind='qr') gets **no** attachment but survives;
- the hard duplicate UNIQUE indexes are gone → two receipts may share a file_hash;
- no receipt data is lost across the migration.

Run only with a real DB (skipped by default via --ignore=tests/migrations):
    POSTGRES__POSTGRES_URL=postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test \\
    pytest tests/migrations/test_receipt_attachments_migration.py -q
"""
from __future__ import annotations

import asyncio
import os
import subprocess
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

POSTGRES_URL: str = os.environ.get(
    "POSTGRES__POSTGRES_URL",
    "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq_test",
)
_BACKEND_ROOT = str(Path(__file__).resolve().parents[2])


def _alembic(*args: str) -> None:
    result = subprocess.run(
        ["alembic", "-c", "alembic.ini", *args],
        check=False, cwd=_BACKEND_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, "POSTGRES__POSTGRES_URL": POSTGRES_URL},
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {args} failed:\n{result.stdout}\n{result.stderr}")


_SEED = """
INSERT INTO vliq.brand (id, name, slug, is_active, created_at)
  VALUES (1,'B','b',true,now()) ON CONFLICT DO NOTHING;
INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at)
  VALUES (1,1,'+70000000001','active',now()) ON CONFLICT DO NOTHING;
INSERT INTO vliq.receipt (seller_id, brand_id, status, bonus_amount, file_kind, file_url, file_hash,
                          items, fraud_signals, admin_comments, is_deleted, created_at)
  VALUES (1,1,'pending',0,'photo','s3://b/receipts/1/a.jpg','h1','[]','[]','[]',false,now());
INSERT INTO vliq.receipt (seller_id, brand_id, status, bonus_amount, file_kind, file_url, file_hash,
                          qr_raw, fn, fd, fp, items, fraud_signals, admin_comments, is_deleted, created_at)
  VALUES (1,1,'on_review',0,'qr','qr://inline','qh',
          't=20260610T1430&s=599.00&fn=1&i=2&fp=3','1','2','3','[]','[]','[]',false,now());
INSERT INTO vliq.receipt (seller_id, brand_id, status, bonus_amount, file_kind, file_url, file_hash,
                          items, fraud_signals, admin_comments, is_deleted, created_at)
  VALUES (1,1,'pending',0,'pdf','s3://b/receipts/1/d.pdf','h2','[]','[]','[]',false,now());
"""


async def _run_sql(*statements: str) -> None:
    engine = create_async_engine(POSTGRES_URL, echo=False, future=True)
    try:
        async with engine.begin() as conn:
            for stmt in statements:
                await conn.execute(text(stmt))
    finally:
        await engine.dispose()


async def _seed() -> None:
    await _run_sql(*filter(None, (s.strip() for s in _SEED.split(";"))))


@pytest.fixture(scope="module", autouse=True)
def migrate_with_legacy_rows():
    """Seed legacy rows at 0004, then upgrade to head so the backfill runs."""
    _alembic("downgrade", "base")
    _alembic("upgrade", "0004_city_table")
    asyncio.run(_seed())
    _alembic("upgrade", "head")
    yield
    # Clear receipts before downgrade: 0005's downgrade re-creates the UNIQUE
    # file_hash index, which would fail on the duplicate rows a test inserts.
    asyncio.run(_run_sql("DELETE FROM vliq.receipt_attachment", "DELETE FROM vliq.receipt"))
    _alembic("downgrade", "base")


@pytest_asyncio.fixture()
async def pg_engine():
    """Fresh per-test async engine (avoids cross-event-loop reuse)."""
    engine = create_async_engine(POSTGRES_URL, echo=False, future=True)
    yield engine
    await engine.dispose()


@pytest.mark.asyncio
async def test_backfill__file_based_receipts_get_one_attachment(pg_engine):
    async with pg_engine.connect() as conn:
        rows = (
            await conn.execute(
                text(
                    "SELECT r.file_kind, count(a.id) AS n, max(a.kind::text) AS kind, max(a.position) AS pos "
                    "FROM vliq.receipt r LEFT JOIN vliq.receipt_attachment a ON a.receipt_id = r.id "
                    "GROUP BY r.id, r.file_kind ORDER BY r.id"
                )
            )
        ).all()

    by_kind = {r[0]: (r[1], r[2], r[3]) for r in rows}
    assert by_kind["photo"] == (1, "image", 0)
    assert by_kind["pdf"] == (1, "pdf", 0)
    # QR-only receipt keeps zero attachments but still exists.
    assert by_kind["qr"][0] == 0


@pytest.mark.asyncio
async def test_backfill__no_receipt_data_lost(pg_engine):
    async with pg_engine.connect() as conn:
        total = (
            await conn.execute(text("SELECT count(*) FROM vliq.receipt WHERE file_url NOT LIKE '%dup.jpg'"))
        ).scalar_one()
    assert total == 3


@pytest.mark.asyncio
async def test_duplicate_file_hash_allowed_after_migration(pg_engine):
    """The dropped UNIQUE index means a repeated file_hash inserts fine (dup = signal)."""
    async with pg_engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO vliq.receipt (seller_id, brand_id, status, bonus_amount, file_kind, file_url, "
                "file_hash, items, fraud_signals, admin_comments, is_deleted, created_at) "
                "VALUES (1,1,'pending',0,'photo','s3://b/receipts/1/dup.jpg','h1','[]','[]','[]',false,now())"
            )
        )
        n = (await conn.execute(text("SELECT count(*) FROM vliq.receipt WHERE file_hash='h1'"))).scalar_one()
    assert n == 2  # two receipts now share file_hash 'h1' — no hard block
