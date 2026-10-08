"""PG integration: seller receipt history paginates stably for 50+ receipts.

The bug: a seller with 50+ receipts 'lost' some from the list because the endpoint
returned one page ordered by created_at only. Receipts upload in bursts sharing a
created_at, so without an id tiebreaker offset/limit pagination duplicates/skips
rows. Here ALL 55 receipts share one created_at to stress the tiebreaker; walking
every page must yield each receipt exactly once, and the on_review subset too.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.receipt.models import Receipt
from src.seller.handlers.api.v1.router import get_me_receipts
from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio

_TS = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
_TOKEN = {"user_id": SEED_SELLER_ID}


async def _seed(s: AsyncSession, n_on_review: int, n_approved: int) -> None:
    for i in range(n_on_review):
        s.add(Receipt(seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, status="on_review", created_at=_TS))
    for i in range(n_approved):
        s.add(Receipt(seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, status="approved", created_at=_TS))


async def _walk_all(s: AsyncSession, *, status: str | None, limit: int) -> tuple[list[str], int]:
    seen: list[str] = []
    total = 0
    page = 1
    while True:
        resp = await get_me_receipts(token=_TOKEN, session=s, page=page, limit=limit, status=status)
        total = resp.total
        seen.extend(str(it.id) for it in resp.items)
        if not resp.has_more:
            break
        page += 1
    return seen, total


async def test_all_receipts_visible_across_pages_no_dupes_or_gaps(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as s, s.begin():
        await _seed(s, n_on_review=40, n_approved=15)  # 55 total, all same created_at

    async with session_factory() as s:
        seen, total = await _walk_all(s, status=None, limit=20)

    assert total == 55                    # API reports the true count
    assert len(seen) == 55                # every page-worth was returned
    assert len(set(seen)) == 55           # no duplicates and no skips across pages


async def test_on_review_receipts_paginate_completely(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as s, s.begin():
        await _seed(s, n_on_review=40, n_approved=15)

    async with session_factory() as s:
        seen, total = await _walk_all(s, status="on_review", limit=20)

    assert total == 40
    assert len(seen) == 40
    assert len(set(seen)) == 40
