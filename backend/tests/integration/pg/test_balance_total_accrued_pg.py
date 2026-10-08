"""PG integration: "total_accrued" nets corrections (Option A).

The metric bucketing lives in SQL (``CASE WHEN kind IN (...)``) that mock
sessions never execute, so this is verified against a real Postgres.

Business rule: a receipt approved then rejected books ``accrual_receipt +X``
then ``correction -X``; an admin bonus edit on an approved receipt books a
``correction`` for the diff. ``total_accrued`` must count corrections so it
stays in sync with ``available`` (which already does).
"""
from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.bonus_transaction.models import BonusTransaction, BonusTransactionKind
from src.seller.services.balance_service import get_seller_balance

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio


def _bt(kind: BonusTransactionKind, amount: int, *, source_type: str = "receipt", source_id: int) -> BonusTransaction:
    return BonusTransaction(
        seller_id=SEED_SELLER_ID,
        brand_id=SEED_BRAND_ID,
        amount=amount,
        kind=kind.value,
        source_type=source_type,
        source_id=source_id,
        reason="test",
        created_by=1,
    )


async def test_total_accrued_nets_reversal_of_rejected_after_approval(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as s, s.begin():
        # Receipt A: approved then rejected -> +2000 accrual, -2000 correction.
        s.add(_bt(BonusTransactionKind.accrual_receipt, 2000, source_id=1))
        s.add(_bt(BonusTransactionKind.correction, -2000, source_id=1))
        # Receipt B: cleanly approved -> +5000.
        s.add(_bt(BonusTransactionKind.accrual_receipt, 5000, source_id=2))

    async with session_factory() as s:
        bal = await get_seller_balance(seller_id=SEED_SELLER_ID, session=s)

    # The rejected-after-approval receipt no longer inflates total_accrued...
    assert bal.total_accrued == 5000
    # ...and the two metrics stay in sync.
    assert bal.available == 5000


async def test_total_accrued_reflects_post_approval_bonus_edit_up(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as s, s.begin():
        s.add(_bt(BonusTransactionKind.accrual_receipt, 1000, source_id=3))
        s.add(_bt(BonusTransactionKind.correction, 500, source_id=3))  # admin edited bonus up

    async with session_factory() as s:
        bal = await get_seller_balance(seller_id=SEED_SELLER_ID, session=s)

    assert bal.total_accrued == 1500
    assert bal.available == 1500


async def test_payout_reverted_is_not_counted_as_accrual(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as s, s.begin():
        s.add(_bt(BonusTransactionKind.accrual_receipt, 3000, source_id=4))
        # A failed payout returns money to spendable balance but is NOT a new accrual.
        s.add(_bt(BonusTransactionKind.payout_reverted, 1000, source_type="payout", source_id=99))

    async with session_factory() as s:
        bal = await get_seller_balance(seller_id=SEED_SELLER_ID, session=s)

    assert bal.total_accrued == 3000   # payout_reverted excluded from "accrued"
    assert bal.available == 4000       # but it does restore spendable balance
