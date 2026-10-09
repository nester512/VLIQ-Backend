"""PG integration: the stage boot re-seeds demo data on EVERY start (SEED_DEMO=true).

Regression 2026-10-09: migration 0012 linked the demo payouts to the demo receipts
(payout_receipt, ON DELETE RESTRICT); the next boot's demo seed deleted the receipts
first, the FK refused, the backend crash-looped and the stage deploy rolled back.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text
from src.scripts.seed_dev import run_seed

pytestmark = pytest.mark.asyncio
_MIGRATION = Path(__file__).resolve().parents[3] / "migrations/alembic/versions/0012_payouts.py"


def _coverage_sql() -> str:
    spec = importlib.util.spec_from_file_location("m0012", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module.COVERAGE


async def test_demo_seed_survives_a_restart_with_payout_coverage(session_factory, monkeypatch) -> None:
    monkeypatch.setenv("SEED_DEMO", "true")
    async with session_factory() as s, s.begin():  # the fixture's brand stands in for the seed's own
        await s.execute(text("DELETE FROM vliq.seller WHERE brand_id = 1"))
        await s.execute(text("DELETE FROM vliq.brand WHERE id = 1"))
    await run_seed()
    async with session_factory() as s, s.begin():
        await s.execute(text(_coverage_sql()))  # what 0012 does on the first boot
        linked = (await s.execute(text("SELECT count(*) FROM vliq.payout_receipt"))).scalar_one()
    assert linked > 0  # the demo payouts really cover demo receipts

    await run_seed()  # the next boot must not fail

    async with session_factory() as s:
        receipts = (await s.execute(text("SELECT count(*) FROM vliq.receipt WHERE seller_id = 12345"))).scalar_one()
    assert receipts > 0
