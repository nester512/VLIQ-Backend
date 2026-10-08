"""Balance aggregation service for sellers (H23).

Formula from docs/reviews/04-antifraud.md:
  available = SUM(amount) FILTER (WHERE kind IN accruals + payout_reverted + correction)
            + SUM(amount) FILTER (WHERE kind = payout_hold)   -- already negative
  on_hold   = ABS(SUM(amount) FILTER (WHERE kind = payout_hold))
  total_accrued = SUM(amount) FILTER (WHERE kind IN accrual_* + correction)  -- net of reversals/edits
  total_paid_out = ABS(SUM(amount) FILTER (WHERE kind = payout_completed))

Note: payout_completed is NOT included in available — when payout_hold transitions
to payout_completed the hold record is already reflected. The ledger invariant
requires total balance (SUM of all amounts) to never go negative.
"""

from __future__ import annotations

import logging

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.bonus_transaction.models import BonusTransaction, BonusTransactionKind
from src.seller.schemas.api import SellerBalanceRead

logger = logging.getLogger(__name__)

# Kinds that positively contribute to available balance.
_AVAILABLE_ACCRUAL_KINDS = {
    BonusTransactionKind.accrual_receipt.value,
    BonusTransactionKind.accrual_promo.value,
    BonusTransactionKind.accrual_manual.value,
    BonusTransactionKind.payout_reverted.value,
    BonusTransactionKind.correction.value,
}

# Pure accrual kinds — bonus credited to the seller.
_ACCRUAL_KINDS = {
    BonusTransactionKind.accrual_receipt.value,
    BonusTransactionKind.accrual_promo.value,
    BonusTransactionKind.accrual_manual.value,
}

# Kinds summed into the "total accrued" metric — the NET lifetime accrual:
# raw accruals PLUS every ``correction`` that adjusts them. A ``correction`` is
# written both when an approved receipt is later rejected (accrual reversed) and
# when an admin edits the bonus of an approved receipt. Without ``correction``
# here, "total accrued" keeps the bonus of a rejected-after-approval receipt and
# ignores post-approval edits — desyncing it from ``available`` (which already
# nets corrections). ``payout_reverted`` is deliberately excluded: it restores
# spendable balance after a failed payout, it is not a new accrual.
_TOTAL_ACCRUED_KINDS = _ACCRUAL_KINDS | {BonusTransactionKind.correction.value}


async def get_seller_balance(*, seller_id: int, session: AsyncSession) -> SellerBalanceRead:
    """Compute seller balance via a single aggregate SQL query.

    Returns a SellerBalanceRead dataclass-style object with:
      available     — spendable balance
      on_hold       — amount locked in pending/in_progress payout requests
      total_accrued — lifetime accrued bonuses
      total_paid_out— lifetime completed payouts
    """
    # Build conditional aggregates in one round-trip.
    available_accruals_sum = func.coalesce(
        func.sum(
            case(
                (BonusTransaction.kind.in_(list(_AVAILABLE_ACCRUAL_KINDS)), BonusTransaction.amount),
                else_=0,
            )
        ),
        0,
    )
    payout_hold_sum = func.coalesce(
        func.sum(
            case(
                (BonusTransaction.kind == BonusTransactionKind.payout_hold.value, BonusTransaction.amount),
                else_=0,
            )
        ),
        0,
    )
    total_accrued_sum = func.coalesce(
        func.sum(
            case(
                (BonusTransaction.kind.in_(list(_TOTAL_ACCRUED_KINDS)), BonusTransaction.amount),
                else_=0,
            )
        ),
        0,
    )
    payout_completed_sum = func.coalesce(
        func.sum(
            case(
                (BonusTransaction.kind == BonusTransactionKind.payout_completed.value, BonusTransaction.amount),
                else_=0,
            )
        ),
        0,
    )

    stmt = select(
        available_accruals_sum.label("available_accruals"),
        payout_hold_sum.label("payout_hold"),
        total_accrued_sum.label("total_accrued"),
        payout_completed_sum.label("payout_completed"),
    ).where(BonusTransaction.seller_id == seller_id)

    result = await session.execute(stmt)
    row = result.one()

    available_accruals: int = row.available_accruals
    payout_hold: int = row.payout_hold  # negative by convention
    total_accrued: int = row.total_accrued
    payout_completed: int = row.payout_completed  # negative by convention

    # available = positive accruals + negative hold amounts (hold is already negative)
    available = available_accruals + payout_hold
    on_hold = abs(payout_hold)
    total_paid_out = abs(payout_completed)

    logger.debug(
        "balance_service.computed seller_id=%s available=%s on_hold=%s",
        seller_id,
        available,
        on_hold,
    )

    return SellerBalanceRead(
        available=available,
        on_hold=on_hold,
        total_accrued=total_accrued,
        total_paid_out=total_paid_out,
    )
