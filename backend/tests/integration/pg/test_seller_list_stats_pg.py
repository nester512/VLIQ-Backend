"""PG integration: admin seller list/card aggregates, sorts, filters and risk on real SQL.

Mock-session tests only see the statement shape; these run the real aggregates
(FILTER clauses, jsonpath duplicate detection, OUTER JOIN NULLs, ordering) and
walk the pages to prove offset pagination never repeats or skips a seller.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.receipt.models import Receipt
from src.seller.handlers.api.v1.router import get_seller, list_sellers
from src.seller.models import Seller

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio

_ADMIN = {"user_id": 1, "role": "admin"}
_NOW = datetime.now(UTC)
_OLD = _NOW - timedelta(days=90)

# telegram_id → (approved, rejected, on_review, recent(30d), duplicates)
ACTIVE_FREQUENT = 9001  # 12 approved, all recent
POPULAR_OLD = 9002  # 20 approved, all 90 days old → most popular, zero frequency
RISKY = 9003  # 3 approved, 7 rejected, 4 with duplicate signals → high risk
REVIEW_WAIT = 9004  # 1 on_review
SILENT = 9005  # no receipts at all
BLOCKED = 9006


def _receipt(seller_id: int, status: str, created_at: datetime, *, dup: bool = False) -> Receipt:
    signals = [{"signal": "historical_duplicate_fiscal", "severity": "high"}] if dup else []
    return Receipt(
        seller_id=seller_id,
        brand_id=SEED_BRAND_ID,
        status=status,
        created_at=created_at,
        total_sum=10000,
        bonus_amount=500 if status == "approved" else 0,
        fraud_signals=signals,
    )


@pytest_asyncio.fixture
async def seeded(session_factory: async_sessionmaker[AsyncSession]) -> None:
    async with session_factory() as s, s.begin():
        await s.execute(text("TRUNCATE vliq.payout_request RESTART IDENTITY CASCADE"))
        await s.execute(text("DELETE FROM vliq.seller WHERE telegram_id <> :tid"), {"tid": SEED_SELLER_ID})
        names = {
            ACTIVE_FREQUENT: ("Анна", "Частая", "active"),
            POPULAR_OLD: ("Борис", "Популярный", "active"),
            RISKY: ("Виктор", "Рисковый", "active"),
            REVIEW_WAIT: ("Галина", "Ожидающая", "active"),
            SILENT: ("Дмитрий", "Молчун", "pending"),
            BLOCKED: ("Елена", "Заблокированная", "blocked"),
        }
        for i, (tid, (first, last, status)) in enumerate(names.items()):
            s.add(
                Seller(
                    telegram_id=tid,
                    brand_id=SEED_BRAND_ID,
                    phone_e164=f"+7900000{tid:04d}",
                    first_name=first,
                    last_name=last,
                    outlet_name=f"Точка {tid}",
                    city="Казань" if tid == RISKY else "Москва",
                    status=status,
                    created_at=_NOW - timedelta(days=10 - i),
                )
            )
        await s.flush()
        s.add_all(_receipt(ACTIVE_FREQUENT, "approved", _NOW - timedelta(days=1)) for _ in range(12))
        s.add_all(_receipt(POPULAR_OLD, "approved", _OLD) for _ in range(20))
        s.add_all(_receipt(RISKY, "approved", _NOW - timedelta(days=2)) for _ in range(3))
        s.add_all(_receipt(RISKY, "rejected", _NOW - timedelta(days=2), dup=i < 4) for i in range(7))
        s.add(_receipt(REVIEW_WAIT, "on_review", _NOW))
        # Soft-deleted receipts never count.
        deleted = _receipt(SILENT, "approved", _NOW)
        deleted.is_deleted = True
        s.add(deleted)


async def _ids(s: AsyncSession, **params) -> list[int]:
    defaults = {
        "page": 1,
        "limit": 50,
        "sort": "created_at:desc",
        "brand_id": None,
        "status": None,
        "city": None,
        "risk": None,
        "has_on_review": None,
        "search": None,
        "date_from": None,
        "date_to": None,
    }
    resp = await list_sellers(session=s, token=_ADMIN, **{**defaults, **params})
    return [it.telegram_id for it in resp.items]


async def test_sort_by_popularity_and_frequency(session_factory, seeded) -> None:
    async with session_factory() as s:
        popular = await _ids(s, sort="receipts_total:desc")
        frequent = await _ids(s, sort="receipts_30d:desc")

    assert popular[:3] == [POPULAR_OLD, ACTIVE_FREQUENT, RISKY]
    assert frequent[:3] == [ACTIVE_FREQUENT, RISKY, REVIEW_WAIT]
    assert frequent.index(POPULAR_OLD) > frequent.index(REVIEW_WAIT)  # old receipts ≠ frequency


async def test_risk_score_and_filter(session_factory, seeded) -> None:
    async with session_factory() as s:
        high = await _ids(s, risk="high")
        by_risk = await _ids(s, sort="risk_score:desc")
        resp = await list_sellers(
            session=s, token=_ADMIN, page=1, limit=50, sort="created_at:desc", brand_id=None, status=None,
            city=None, risk=None, has_on_review=None, search="Рисковый", date_from=None, date_to=None,
        )

    assert high == [RISKY]
    assert by_risk[0] == RISKY
    stats = resp.items[0].stats
    # reject_rate 7/10 = 0.7, duplicate_rate 4/10 = 0.4 → 100 * (0.5*0.7 + 0.5*0.4) = 55
    assert stats.risk_score == 55
    assert stats.risk_level == "high"
    assert stats.risk_flags == ["high_reject_rate", "duplicates"]
    assert stats.receipts_duplicates == 4


async def test_filters_status_on_review_city_search(session_factory, seeded) -> None:
    async with session_factory() as s:
        assert await _ids(s, status="blocked") == [BLOCKED]
        assert await _ids(s, has_on_review=True) == [REVIEW_WAIT]
        assert await _ids(s, city="Казань") == [RISKY]
        assert await _ids(s, search=str(SILENT)) == [SILENT]  # exact telegram_id
        assert await _ids(s, search="точка 9002") == [POPULAR_OLD]  # outlet, case-insensitive


async def test_seller_without_receipts_has_zero_stats(session_factory, seeded) -> None:
    async with session_factory() as s:
        resp = await list_sellers(
            session=s, token=_ADMIN, page=1, limit=50, sort="created_at:desc", brand_id=None, status=None,
            city=None, risk=None, has_on_review=None, search=str(SILENT), date_from=None, date_to=None,
        )

    stats = resp.items[0].stats
    assert stats.receipts_total == 0  # the soft-deleted receipt is excluded
    assert stats.last_receipt_at is None
    assert stats.risk_level == "low"


async def test_pagination_walks_every_seller_once(session_factory, seeded) -> None:
    seen: list[int] = []
    async with session_factory() as s:
        for page in range(1, 10):
            # receipts_total ties (several sellers with 0/1) exercise the telegram_id tiebreaker.
            seen += await _ids(s, sort="receipts_total:asc", page=page, limit=2)

    assert len(seen) == 7  # 6 seeded + the conftest seed seller
    assert len(set(seen)) == 7


async def test_get_seller_card_stats(session_factory, seeded) -> None:
    async with session_factory() as s:
        card = await get_seller(telegram_id=ACTIVE_FREQUENT, token=_ADMIN, session=s)

    assert card.receipts_total == 12
    assert card.stats.receipts_approved == 12
    assert card.stats.receipts_30d == 12
    assert card.avg_bonus == 500
    assert sum(w.receipts for w in card.weekly_activity) == 12
    assert all(w.approved == w.receipts for w in card.weekly_activity)
