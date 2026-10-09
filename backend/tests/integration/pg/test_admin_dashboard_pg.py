"""PG integration: GET /analytics/dashboard aggregates on real SQL.

Covers what the old client-side computation got wrong on large data: counts over
the whole DB (not a 200-row page), paid-this-month by the paid transition date,
zero-filled daily series, top sellers by approved count and top products from JSONB.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.analytics.service import DAILY_DAYS, get_admin_dashboard
from src.bonus_transaction.models import BonusTransaction
from src.payout_request.models import PayoutRequest
from src.receipt.models import Receipt
from src.seller.models import Seller

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio

TOP = 8001
SECOND = 8002
PENDING_SELLER = 8003
_NOW = datetime.now(UTC)
_LAST_YEAR = _NOW - timedelta(days=400)


def _receipt(  # noqa: PLR0913
    seller_id: int, status: str, *, total: int | None = 10000, items=None, created_at=None, deleted=False):
    return Receipt(
        seller_id=seller_id,
        brand_id=SEED_BRAND_ID,
        status=status,
        total_sum=total,
        items=items or [],
        created_at=created_at or _NOW,
        is_deleted=deleted,
    )


def _payout(seller_id: int, status: str, amount: int, updated_at: datetime) -> PayoutRequest:
    return PayoutRequest(
        seller_id=seller_id,
        brand_id=SEED_BRAND_ID,
        amount=amount,
        payout_kind="card",
        payout_masked="•••• 0000",
        status=status,
        created_at=updated_at,
        updated_at=updated_at,
    )


@pytest_asyncio.fixture
async def seeded(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as s, s.begin():
        await s.execute(text("TRUNCATE vliq.payout_request RESTART IDENTITY CASCADE"))
        await s.execute(text("DELETE FROM vliq.seller WHERE telegram_id <> :tid"), {"tid": SEED_SELLER_ID})
        for tid, status in ((TOP, "active"), (SECOND, "active"), (PENDING_SELLER, "pending")):
            s.add(
                Seller(
                    telegram_id=tid,
                    brand_id=SEED_BRAND_ID,
                    phone_e164=f"+7911000{tid:04d}",
                    first_name=f"S{tid}",
                    city="Москва",
                    status=status,
                    created_at=_NOW,
                )
            )
        await s.flush()
        liquid = [{"raw_name": "SWONQ L18000", "qty": 3, "price": 1000}]
        cart = [{"name": "Картридж", "price": 300}]  # no qty → counts as 1
        ocr_noise = [{"raw_name": "Испаритель", "qty": "2 шт", "price": 100}]  # non-numeric qty → 1, no 500
        s.add_all(_receipt(TOP, "approved", total=20000, items=liquid) for _ in range(3))
        s.add(_receipt(TOP, "paid_out", total=10000, items=cart))
        s.add(_receipt(SECOND, "approved", total=30000, items=cart + ocr_noise))
        s.add_all(_receipt(SECOND, "rejected", items=liquid) for _ in range(5))  # rejected items don't count
        s.add_all(_receipt(SECOND, "on_review", total=None) for _ in range(2))
        s.add(_receipt(SEED_SELLER_ID, "on_review", created_at=_NOW - timedelta(days=DAILY_DAYS + 5)))
        s.add(_receipt(TOP, "approved", total=999999, deleted=True))  # soft-deleted: ignored everywhere

        # Accrued for all time: SECOND earned more bonus than TOP despite fewer approved receipts.
        for seller, kind, amount in ((TOP, "accrual_receipt", 4000), (SECOND, "accrual_receipt", 9000),
                                     (SECOND, "correction", -1000)):  # fmt: skip
            s.add(BonusTransaction(seller_id=seller, brand_id=SEED_BRAND_ID, amount=amount, kind=kind,
                                   source_type="receipt", source_id=1))  # fmt: skip
        s.add(_payout(TOP, "paid", 5000, _NOW))
        s.add(_payout(TOP, "paid", 7000, _LAST_YEAR))  # paid long ago: lifetime yes, this month no
        s.add(_payout(SECOND, "new", 1000, _NOW))
        s.add(_payout(SECOND, "in_progress", 2000, _NOW))
        s.add(_payout(SECOND, "rejected", 9000, _NOW))


async def test_dashboard_aggregates(session_factory, seeded) -> None:
    async with session_factory() as s:
        d = await get_admin_dashboard(s)

    assert d.sellers_total == 4  # 3 seeded + conftest seed seller
    assert d.sellers_active == 3
    assert d.receipts_total == 13  # 4 + 8 + 1; the deleted one excluded
    assert d.receipts_on_review == 3
    assert d.avg_check == round((3 * 20000 + 10000 + 30000) / 5)
    assert (d.payouts_pending, d.payouts_pending_amount) == (2, 3000)
    if _LAST_YEAR.month != _NOW.month or _LAST_YEAR.year != _NOW.year:
        assert (d.payouts_paid_month, d.payouts_paid_month_amount) == (1, 5000)


async def test_dashboard_daily_series_zero_filled(session_factory, seeded) -> None:
    async with session_factory() as s:
        d = await get_admin_dashboard(s)

    assert len(d.daily_receipts) == DAILY_DAYS
    days = [x.day for x in d.daily_receipts]
    assert days == sorted(days)
    assert sum(x.receipts for x in d.daily_receipts) == 12  # the 35-day-old receipt is outside
    assert d.daily_receipts[-1].receipts == 12


async def test_dashboard_top_sellers_and_products(session_factory, seeded) -> None:
    async with session_factory() as s:
        d = await get_admin_dashboard(s)

    # Ranked by accrued for all time (net of corrections), not by receipt count.
    first, second = d.top_sellers[0], d.top_sellers[1]
    assert (first.telegram_id, first.total_accrued) == (SECOND, 8000)
    assert (first.receipts_approved, first.receipts_total, first.paid) == (1, 8, 0)
    assert (second.telegram_id, second.total_accrued) == (TOP, 4000)
    assert (second.receipts_approved, second.receipts_total) == (4, 4)
    assert second.sales == 3 * 20000 + 10000
    assert second.paid == 12000  # lifetime paid payouts
    assert all(t.telegram_id != PENDING_SELLER for t in d.top_sellers)  # no receipts → not ranked

    # Equal accrued → more approved receipts first, then telegram_id (stable).
    zero = [t for t in d.top_sellers if t.total_accrued == 0]
    assert [t.telegram_id for t in zero] == sorted((t.telegram_id for t in zero), key=lambda tid: tid)

    products = {p.name: p.count for p in d.top_products}
    assert products == {"SWONQ L18000": 9.0, "Картридж": 2.0, "Испаритель": 1.0}
    assert d.top_products[0].name == "SWONQ L18000"
