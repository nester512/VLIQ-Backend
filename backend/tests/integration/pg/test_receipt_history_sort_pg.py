"""PG integration: sorting a receipt history («Все чеки», a seller's receipts) — owner, 2026-10-11.

- newest / oldest by upload time;
- by the purchase total and by the bonus, both directions; receipts without the value go last;
- equal values page without repeats or gaps (id breaks the tie).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from src.receipt.handlers.api.v1.router import ReceiptQueueSort, list_receipts
from src.receipt.models import Receipt

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio
ADMIN = {"user_id": 777, "role": "admin"}
_T0 = datetime.now(UTC) - timedelta(hours=3)


async def _seed(sm) -> dict[str, int]:
    rows = {
        # name: (minutes after T0, total_sum, bonus)
        "old_cheap": (0, 50_000, 30_000),
        "mid_dear": (1, 900_000, 10_000),
        "new_mid": (2, 300_000, 0),
        "newest_nosum": (3, None, 50_000),
        "tie_a": (4, 300_000, 20_000),
    }
    ids = {}
    async with sm() as s, s.begin():
        for name, (minutes, total, bonus) in rows.items():
            r = Receipt(seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, status="approved", bonus_amount=bonus,
                        total_sum=total, created_at=_T0 + timedelta(minutes=minutes))  # fmt: skip
            s.add(r)
            await s.flush()
            ids[name] = r.id
    return ids


async def _list(sm, sort: ReceiptQueueSort, order: str, limit: int = 50, page: int = 1) -> list[int]:
    async with sm() as s:
        res = await list_receipts(
            ADMIN, s, page=page, limit=limit, status_filter=None, seller_id=SEED_SELLER_ID, from_date=None,
            to_date=None, order=order, queue=False, sort=sort,
        )  # fmt: skip
        return [int(i.id) for i in res.items]


async def test_by_upload_time_both_ways(session_factory) -> None:
    ids = await _seed(session_factory)
    newest = await _list(session_factory, ReceiptQueueSort.created, "desc")
    assert newest == [ids["tie_a"], ids["newest_nosum"], ids["new_mid"], ids["mid_dear"], ids["old_cheap"]]
    assert await _list(session_factory, ReceiptQueueSort.created, "asc") == newest[::-1]


async def test_by_total_sum_largest_or_smallest_first_empty_last(session_factory) -> None:
    ids = await _seed(session_factory)
    dear = await _list(session_factory, ReceiptQueueSort.total_sum, "desc")
    # 300 000 twice: the newer id first when descending
    assert dear == [ids["mid_dear"], ids["tie_a"], ids["new_mid"], ids["old_cheap"], ids["newest_nosum"]]
    cheap = await _list(session_factory, ReceiptQueueSort.total_sum, "asc")
    assert cheap == [ids["old_cheap"], ids["new_mid"], ids["tie_a"], ids["mid_dear"], ids["newest_nosum"]]


async def test_by_bonus(session_factory) -> None:
    ids = await _seed(session_factory)
    assert await _list(session_factory, ReceiptQueueSort.bonus, "desc") == [
        ids["newest_nosum"], ids["old_cheap"], ids["tie_a"], ids["mid_dear"], ids["new_mid"],
    ]  # fmt: skip


async def test_pages_have_no_repeats_or_gaps(session_factory) -> None:
    await _seed(session_factory)
    whole = await _list(session_factory, ReceiptQueueSort.total_sum, "desc")
    paged = [
        i for p in (1, 2, 3) for i in await _list(session_factory, ReceiptQueueSort.total_sum, "desc", limit=2, page=p)
    ]
    assert paged == whole
