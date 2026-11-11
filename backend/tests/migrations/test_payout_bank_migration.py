"""Migration 0015_payout_bank — additive, re-runnable, data intact, clean downgrade."""

from __future__ import annotations

import pytest

from tests.migrations.test_hot_path_indexes_migration import _alembic, sql

_FP = (
    "SELECT count(*), sum(hashtext(concat_ws('|', id, seller_id, amount, payout_kind, payout_masked, status, "
    "created_at))::bigint) FROM vliq.payout_request"
)
_COLS = (
    "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'vliq' "
    "AND table_name = 'payout_request' AND column_name IN ('bank_id', 'bank_name')"
)


@pytest.fixture(scope="module")
def at_0014():
    _alembic("downgrade", "base")
    _alembic("upgrade", "0014_backfill_paid_out")
    sql(
        "INSERT INTO vliq.brand (id, name, slug, is_active, created_at) VALUES (1,'B','b',true,now()) ON CONFLICT DO NOTHING",
        "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) "
        "SELECT g, 1, '+7900000' || lpad(g::text, 4, '0'), 'active', now() FROM generate_series(1, 20) g",
        "INSERT INTO vliq.payout_request (seller_id, brand_id, amount, payout_kind, payout_masked, status, created_at) "
        "SELECT g, 1, 300000 + g, 'sbp_phone', '+7999000' || lpad(g::text, 4, '0'), 'new', now() "
        "FROM generate_series(1, 20) g",
    )
    before = sql(_FP)[0]
    yield before
    sql("DELETE FROM vliq.payout_request", "DELETE FROM vliq.seller")
    _alembic("downgrade", "base")


def test_upgrade_keeps_requests_and_leaves_the_bank_empty(at_0014) -> None:
    _alembic("upgrade", "0015_payout_bank")
    assert sql(_FP)[0] == at_0014
    assert sql(_COLS)[0][0] == 2
    assert sql("SELECT count(*) FROM vliq.payout_request WHERE bank_id IS NOT NULL OR bank_name IS NOT NULL")[0][0] == 0


def test_rerun_after_a_partial_apply(at_0014) -> None:
    sql("UPDATE public.alembic_version SET version_num = '0014_backfill_paid_out'")  # DDL stays, version rolled back
    _alembic("upgrade", "head")
    assert sql(_FP)[0] == at_0014


def test_downgrade_removes_only_what_it_added(at_0014) -> None:
    sql("UPDATE vliq.payout_request SET bank_id = '100000000111', bank_name = 'Сбербанк' WHERE id % 2 = 0")
    _alembic("downgrade", "0014_backfill_paid_out")
    assert sql(_COLS)[0][0] == 0
    assert sql(_FP)[0] == at_0014
    _alembic("upgrade", "head")
