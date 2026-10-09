"""Migration 0012_payouts — production-safety behaviour on real PostgreSQL.

- existing payouts get their receipt coverage (FIFO by receipt age, rejected
  payouts cover nothing), paid / rejected requests get paid_at / rejected_at;
- no existing row of receipt / payout_request / bonus_transaction changes —
  receipt statuses in particular stay as they were;
- the coverage backfill is idempotent; the idempotency index is VALID and unique;
- downgrade removes only what 0012 added.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from tests.migrations.test_hot_path_indexes_migration import _alembic, indexes, sql

_MIGRATION = Path(__file__).resolve().parents[2] / "migrations/alembic/versions/0012_payouts.py"
_spec = importlib.util.spec_from_file_location("m0012", _MIGRATION)
m0012 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m0012)  # type: ignore[union-attr]

_SEED = [
    "INSERT INTO vliq.brand (id, name, slug, is_active, created_at) VALUES (1,'B','b',true,now()) ON CONFLICT DO NOTHING",
    "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) VALUES (1,1,'+70000000001','active',now())",
    # Three approved receipts, 2 000 ₽ each, oldest first: ids 1, 2, 3.
    """INSERT INTO vliq.receipt (id, seller_id, brand_id, status, bonus_amount, items, fraud_signals, admin_comments,
                                is_deleted, created_at)
       SELECT g, 1, 1, 'approved', 200000, '[]', '[]', '[]', false, now() - ((10 - g) || ' days')::interval
       FROM generate_series(1, 3) g""",
    # Paid 3 000 ₽, rejected 1 000 ₽, new 1 500 ₽ — in that order.
    """INSERT INTO vliq.payout_request (id, seller_id, brand_id, amount, payout_kind, payout_masked, status,
                                       created_at, updated_at)
       VALUES (1, 1, 1, 300000, 'sbp_phone', '+79990000000', 'paid', now() - interval '5 days', now() - interval '4 days'),
              (2, 1, 1, 100000, 'sbp_phone', '+79990000000', 'rejected', now() - interval '3 days', now() - interval '3 days'),
              (3, 1, 1, 150000, 'sbp_phone', '+79990000000', 'new', now() - interval '1 day', now() - interval '1 day')""",
    """INSERT INTO vliq.bonus_transaction (seller_id, brand_id, amount, kind, source_type, source_id, created_at)
       VALUES (1, 1, 600000, 'accrual_receipt', 'receipt', 1, now()), (1, 1, -300000, 'payout_hold', 'payout', 1, now()),
              (1, 1, -300000, 'payout_completed', 'payout', 1, now())""",
]

_FINGERPRINT = [
    "SELECT count(*), sum(hashtext(concat_ws('|', id, seller_id, status, bonus_amount, is_deleted, created_at))::bigint)"
    " FROM vliq.receipt",
    "SELECT count(*), sum(hashtext(concat_ws('|', id, seller_id, amount, status, payout_masked, admin_comment, "
    "created_at, updated_at))::bigint) FROM vliq.payout_request",
    "SELECT count(*), sum(hashtext(concat_ws('|', id, amount, kind, source_id))::bigint) FROM vliq.bonus_transaction",
]


def fingerprint() -> list:
    return [sql(q)[0] for q in _FINGERPRINT]


def coverage() -> list[tuple[int, int, int]]:
    return [tuple(r) for r in sql("SELECT payout_id, receipt_id, amount FROM vliq.payout_receipt ORDER BY payout_id, receipt_id")]


@pytest.fixture(scope="module")
def migrated():
    _alembic("downgrade", "base")
    _alembic("upgrade", "0011_receipt_journey")
    sql(*_SEED)
    before = fingerprint()
    _alembic("upgrade", "0012_payouts")
    yield before
    sql("DELETE FROM vliq.payout_receipt", "DELETE FROM vliq.payout_request", "DELETE FROM vliq.bonus_transaction",
        "DELETE FROM vliq.receipt_event", "DELETE FROM vliq.receipt", "DELETE FROM vliq.seller")  # fmt: skip
    _alembic("downgrade", "base")


def test_existing_payouts_get_fifo_coverage(migrated) -> None:
    # paid 3 000 = r1 2 000 + r2 1 000; rejected covers nothing; new 1 500 = r2 1 000 + r3 500.
    assert coverage() == [(1, 1, 200000), (1, 2, 100000), (3, 2, 100000), (3, 3, 50000)]


def test_decided_requests_get_their_timestamps(migrated) -> None:
    rows = sql("SELECT id, paid_at = updated_at, rejected_at = updated_at FROM vliq.payout_request ORDER BY id")
    assert [tuple(r) for r in rows] == [(1, True, None), (2, None, True), (3, None, None)]


def test_no_existing_row_changed(migrated) -> None:
    assert fingerprint() == migrated
    assert [r[0] for r in sql("SELECT status FROM vliq.receipt ORDER BY id")] == ["approved"] * 3


def test_coverage_backfill_is_idempotent(migrated) -> None:
    before = coverage()
    sql(m0012.COVERAGE)
    assert coverage() == before


def test_idempotency_key_is_unique_per_seller(migrated) -> None:
    assert indexes().get(m0012.IDEM_INDEX) is True
    sql("UPDATE vliq.payout_request SET idempotency_key = 'k1' WHERE id = 3")
    with pytest.raises(IntegrityError):
        sql("UPDATE vliq.payout_request SET idempotency_key = 'k1' WHERE id = 2")
    sql("UPDATE vliq.payout_request SET idempotency_key = NULL WHERE id = 3")


def test_rerun_after_a_failed_concurrent_index_step(migrated) -> None:
    """CONCURRENTLY runs after a commit: if it fails, 0012 stays unapplied with its DDL in place."""
    before = coverage()
    sql(f"DROP INDEX vliq.{m0012.IDEM_INDEX}", "UPDATE public.alembic_version SET version_num = '0011_receipt_journey'")
    _alembic("upgrade", "head")
    assert indexes().get(m0012.IDEM_INDEX) is True
    assert coverage() == before
    assert fingerprint() == migrated


def test_downgrade_removes_only_what_it_added(migrated) -> None:
    _alembic("downgrade", "0011_receipt_journey")
    assert sql("SELECT to_regclass('vliq.payout_receipt')")[0][0] is None
    assert m0012.IDEM_INDEX not in indexes()
    assert fingerprint() == migrated
    _alembic("upgrade", "head")
    assert coverage() == [(1, 1, 200000), (1, 2, 100000), (3, 2, 100000), (3, 3, 50000)]
