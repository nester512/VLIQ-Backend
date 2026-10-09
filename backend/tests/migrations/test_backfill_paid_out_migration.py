"""Migration 0014_backfill_paid_out — «Выплачен» on old fully paid receipts, on rollout.

- a receipt fully covered by PAID payouts → paid_out + one backfilled journey event;
- partly paid, covered only by a payout in progress, rejected or deleted → untouched;
- bonuses / ledger / payouts unchanged; re-run is a no-op; downgrade restores exactly.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

from tests.migrations.test_hot_path_indexes_migration import _alembic, sql

_spec = importlib.util.spec_from_file_location(
    "m0014", Path(__file__).resolve().parents[2] / "migrations/alembic/versions/0014_backfill_paid_out.py"
)
m0014 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m0014)  # type: ignore[union-attr]

# Seller 1: receipts 1 (2 000 ₽), 2 (2 000 ₽), 3 (2 000 ₽), oldest first; 4 rejected; 5 deleted.
# Payouts: #1 paid 3 000 ₽ (covers r1 fully, r2 by 1 000), #2 new 1 000 ₽ (r2's rest).
# Seller 2: receipt 6 (1 000 ₽) fully covered by paid #3 — deleted receipts never count.
_SEED = [
    "INSERT INTO vliq.brand (id, name, slug, is_active, created_at) VALUES (1,'B','b',true,now()) ON CONFLICT DO NOTHING",
    "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) VALUES "
    "(1,1,'+70000000001','active',now()), (2,1,'+70000000002','active',now())",
    """INSERT INTO vliq.receipt (id, seller_id, brand_id, status, bonus_amount, items, fraud_signals, admin_comments,
                                is_deleted, created_at) VALUES
       (1,1,1,'approved',200000,'[]','[]','[]',false, now() - interval '10 days'),
       (2,1,1,'approved',200000,'[]','[]','[]',false, now() - interval '9 days'),
       (3,1,1,'approved',200000,'[]','[]','[]',false, now() - interval '8 days'),
       (4,1,1,'rejected',0,'[]','[]','[]',false, now() - interval '7 days'),
       (5,2,1,'approved',100000,'[]','[]','[]',true, now() - interval '6 days'),
       (6,2,1,'approved',100000,'[]','[]','[]',false, now() - interval '5 days')""",
    """INSERT INTO vliq.payout_request (id, seller_id, brand_id, amount, payout_kind, payout_masked, status,
                                       created_at, updated_at) VALUES
       (1,1,1,300000,'sbp_phone','+79990000000','paid', now() - interval '4 days', now() - interval '3 days'),
       (2,1,1,100000,'sbp_phone','+79990000000','new',  now() - interval '2 days', now() - interval '2 days'),
       (3,2,1,100000,'sbp_phone','+79990000000','paid', now() - interval '2 days', now() - interval '1 days')""",
    "INSERT INTO vliq.bonus_transaction (seller_id, brand_id, amount, kind, source_type, source_id, created_at) "
    "VALUES (1,1,600000,'accrual_receipt','receipt',1,now())",
]
_FP = [
    "SELECT sum(hashtext(concat_ws('|', id, seller_id, bonus_amount, is_deleted, created_at))::bigint) FROM vliq.receipt",
    "SELECT sum(hashtext(concat_ws('|', id, amount, status, paid_at))::bigint) FROM vliq.payout_request",
    "SELECT sum(hashtext(concat_ws('|', id, amount, kind))::bigint) FROM vliq.bonus_transaction",
]


def statuses() -> dict[int, str]:
    return {i: st for i, st in sql("SELECT id, status FROM vliq.receipt ORDER BY id")}


def fp() -> list:
    return [sql(q)[0] for q in _FP]


@pytest.fixture(scope="module")
def migrated():
    _alembic("downgrade", "base")
    _alembic("upgrade", "0011_receipt_journey")
    sql(*_SEED)
    _alembic("upgrade", "0013_seller_login")  # 0012 rebuilds the coverage
    before = {"statuses": statuses(), "fp": fp()}
    _alembic("upgrade", "0014_backfill_paid_out")
    yield before
    sql("DELETE FROM vliq.payout_receipt", "DELETE FROM vliq.payout_request", "DELETE FROM vliq.bonus_transaction",
        "DELETE FROM vliq.receipt_event", "DELETE FROM vliq.receipt", "DELETE FROM vliq.seller")  # fmt: skip
    _alembic("downgrade", "base")


def test_only_fully_paid_live_receipts_become_paid_out(migrated) -> None:
    assert migrated["statuses"] == {1: "approved", 2: "approved", 3: "approved", 4: "rejected", 5: "approved", 6: "approved"}
    assert statuses() == {1: "paid_out", 2: "approved", 3: "approved", 4: "rejected", 5: "approved", 6: "paid_out"}


def test_each_gets_one_backfilled_journey_event(migrated) -> None:
    rows = sql("SELECT receipt_id, kind, data->>'payout_id', data->>'migration' FROM vliq.receipt_event "
               "WHERE kind = 'paid_out' ORDER BY receipt_id")  # fmt: skip
    assert [tuple(r) for r in rows] == [(1, "paid_out", "1", "0014"), (6, "paid_out", "3", "0014")]


def test_money_untouched_and_rerun_is_a_no_op(migrated) -> None:
    assert fp() == migrated["fp"]
    sql(m0014.UPGRADE)
    assert sql("SELECT count(*) FROM vliq.receipt_event WHERE kind = 'paid_out'")[0][0] == 2


def test_downgrade_restores_exactly(migrated) -> None:
    _alembic("downgrade", "0013_seller_login")
    assert statuses() == migrated["statuses"]
    assert sql("SELECT count(*) FROM vliq.receipt_event WHERE data->>'migration' = '0014'")[0][0] == 0
    _alembic("upgrade", "head")
    assert statuses()[1] == "paid_out"
