"""Real-PostgreSQL integration tests for create_receipt_package.

Reproduces / guards the P0 defect that mock-session tests hid: the idempotency
SELECT ran before ``session.begin()``, which raised
"A transaction is already begun on this Session." on a real AsyncSession.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.receipt.service import PreparedAttachment, create_receipt_package

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio


def _att(position: int, *, file_hash: str = "h0", mime: str = "image/jpeg") -> PreparedAttachment:
    return PreparedAttachment(
        position=position,
        storage_uri=f"s3://b/receipts/{SEED_SELLER_ID}/{position}.bin",
        mime=mime,
        file_hash=file_hash,
        size_bytes=100 + position,
    )


async def _count(session: AsyncSession, sql: str, **params) -> int:
    return (await session.execute(text(sql), params)).scalar_one()


async def test_create_package__real_session_no_transaction_error(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """One submission → one Receipt + N attachments, atomically, with NO
    'transaction already begun' error on a real session."""
    atts = [_att(i, file_hash=f"h{i}") for i in range(3)]
    async with session_factory() as s:
        receipt, created = await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, attachments=atts, idempotency_key="key-abc12345"
        )
        rid = receipt.id
    assert created is True

    async with session_factory() as s:
        assert await _count(s, "SELECT count(*) FROM vliq.receipt WHERE id=:id", id=rid) == 1
        assert await _count(s, "SELECT count(*) FROM vliq.receipt_attachment WHERE receipt_id=:id", id=rid) == 3
        positions = (
            await s.execute(
                text("SELECT position FROM vliq.receipt_attachment WHERE receipt_id=:id ORDER BY position"), {"id": rid}
            )
        ).scalars().all()
    assert positions == [0, 1, 2]


async def test_create_package__idempotent_retry_returns_same_receipt(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    atts = [_att(0)]
    async with session_factory() as s:
        r1, c1 = await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, attachments=atts, idempotency_key="dup-key-1234"
        )
        id1 = r1.id
    assert c1 is True

    # Retry with the SAME (seller, idempotency_key) on a fresh session.
    async with session_factory() as s:
        r2, c2 = await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, attachments=atts, idempotency_key="dup-key-1234"
        )
        id2 = r2.id
    assert c2 is False
    assert id2 == id1

    # Exactly one Receipt + one attachment — no second insert.
    async with session_factory() as s:
        assert await _count(s, "SELECT count(*) FROM vliq.receipt WHERE seller_id=:s", s=SEED_SELLER_ID) == 1
        assert await _count(s, "SELECT count(*) FROM vliq.receipt_attachment") == 1


async def test_create_package__duplicate_file_hash_allowed(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    """The dropped UNIQUE index means two receipts may share a file_hash (dup = signal)."""
    async with session_factory() as s:
        await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID,
            attachments=[_att(0, file_hash="same")], idempotency_key="k-A-111111",
        )
    async with session_factory() as s:
        await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID,
            attachments=[_att(0, file_hash="same")], idempotency_key="k-B-222222",
        )
    async with session_factory() as s:
        assert await _count(s, "SELECT count(*) FROM vliq.receipt WHERE file_hash='same'") == 2


async def test_create_package__no_idempotency_key_creates_each_time(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as s:
        await create_receipt_package(s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, attachments=[_att(0)])
    async with session_factory() as s:
        await create_receipt_package(s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, attachments=[_att(0)])
    async with session_factory() as s:
        assert await _count(s, "SELECT count(*) FROM vliq.receipt WHERE seller_id=:s", s=SEED_SELLER_ID) == 2
