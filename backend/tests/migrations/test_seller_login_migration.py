"""Migration 0013_seller_login — additive, re-runnable, data intact, clean downgrade."""
from __future__ import annotations

import pytest

from tests.migrations.test_hot_path_indexes_migration import _alembic, sql

_FP = "SELECT count(*), sum(hashtext(concat_ws('|', telegram_id, phone_e164, status, created_at))::bigint) FROM vliq.seller"


@pytest.fixture(scope="module")
def at_0012():
    _alembic("downgrade", "base")
    _alembic("upgrade", "0012_payouts")
    sql(
        "INSERT INTO vliq.brand (id, name, slug, is_active, created_at) VALUES (1,'B','b',true,now()) ON CONFLICT DO NOTHING",
        "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) "
        "SELECT g, 1, '+7900000' || lpad(g::text, 4, '0'), 'active', now() FROM generate_series(1, 50) g",
    )
    before = sql(_FP)[0]
    yield before
    sql("DELETE FROM vliq.seller")
    _alembic("downgrade", "base")


def test_upgrade_keeps_sellers_and_defaults_the_flag(at_0012) -> None:
    _alembic("upgrade", "0013_seller_login")
    assert sql(_FP)[0] == at_0012
    assert sql("SELECT count(*) FROM vliq.seller WHERE primary_login_disabled")[0][0] == 0
    assert sql("SELECT to_regclass('vliq.seller_login') IS NOT NULL")[0][0] is True


def test_rerun_after_a_partial_apply(at_0012) -> None:
    sql("UPDATE public.alembic_version SET version_num = '0012_payouts'")  # DDL stays, version rolled back
    _alembic("upgrade", "head")
    assert sql(_FP)[0] == at_0012


def test_downgrade_removes_only_what_it_added(at_0012) -> None:
    _alembic("downgrade", "0012_payouts")
    assert sql("SELECT to_regclass('vliq.seller_login')")[0][0] is None
    assert sql(_FP)[0] == at_0012
    _alembic("upgrade", "head")
