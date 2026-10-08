"""PG integration: the cleanup selection query only picks objects owned
EXCLUSIVELY by checked (approved/rejected), non-deleted receipts.

Guards the safety invariant: an object shared with a still-pending receipt
(content-addressed dedup) or referenced only by a soft-deleted receipt must NOT
be selected for overwrite.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.receipt.models import Receipt, ReceiptAttachment
from src.scripts.cleanup_checked_receipts import _SELECT_SQL

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio


async def _receipt(s: AsyncSession, status: str, *, is_deleted: bool = False) -> int:
    r = Receipt(seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, status=status, is_deleted=is_deleted)
    s.add(r)
    await s.flush()
    return r.id


async def _attach(s: AsyncSession, receipt_id: int, uri: str, *, position: int = 0) -> None:
    s.add(
        ReceiptAttachment(
            receipt_id=receipt_id, position=position, kind="image", mime_type="image/jpeg",
            storage_uri=uri, file_hash=uri, size_bytes=1000,
        )
    )


async def test_selection_only_picks_exclusively_checked_objects(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as s, s.begin():
        # (1) Object referenced only by an approved receipt → SELECTED.
        appr = await _receipt(s, "approved")
        await _attach(s, appr, "s3://b/receipts/exclusive.jpg")

        # (2) Object shared by a rejected AND an on_review receipt → NOT selected.
        rej = await _receipt(s, "rejected")
        rev = await _receipt(s, "on_review")
        await _attach(s, rej, "s3://b/receipts/shared.jpg")
        await _attach(s, rev, "s3://b/receipts/shared.jpg")

        # (3) Object referenced only by a pending receipt → NOT selected.
        pend = await _receipt(s, "on_review")
        await _attach(s, pend, "s3://b/receipts/pending_only.jpg")

        # (4) Object referenced only by a soft-deleted receipt → NOT selected.
        gone = await _receipt(s, "approved", is_deleted=True)
        await _attach(s, gone, "s3://b/receipts/soft_deleted.jpg")

    async with session_factory() as s:
        rows = (await s.execute(text(_SELECT_SQL))).mappings().all()

    assert {r["uri"] for r in rows} == {"s3://b/receipts/exclusive.jpg"}
