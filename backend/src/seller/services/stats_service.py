"""Per-seller activity statistics and risk factor for the admin "Продавцы" section.

Everything is aggregated in SQL so lists stay correct and fast on large data
(the admin UI used to compute counts client-side over the first page only).

Risk factor (0..100) — a moderation heuristic, NOT a product rule from the BRD;
weights/thresholds are defaults to be confirmed with the product owner:

    risk = 100 * (W_REJECT * reject_rate + W_DUPLICATE * duplicate_rate)

    reject_rate    = rejected / (approved + rejected)        — admin decisions only
    duplicate_rate = receipts with a *duplicate* fraud signal / all receipts

Levels: ``low`` < RISK_MEDIUM <= ``medium`` < RISK_HIGH <= ``high``.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import Float, Integer, Numeric, Select, and_, cast, func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from src.receipt.models import Receipt, ReceiptStatus
from src.seller.schemas.api import SellerStats, SellerWeekActivity

W_REJECT = 0.5
W_DUPLICATE = 0.5
RISK_MEDIUM = 20
RISK_HIGH = 45
# Below this many admin decisions the reject rate is noise; flagged as "мало данных".
RISK_MIN_DECISIONS = 5
HIGH_REJECT_RATE = 0.3
HIGH_DUPLICATE_RATE = 0.1
ACTIVITY_WINDOW_DAYS = 30
WEEKS_OF_HISTORY = 12

_APPROVED = (ReceiptStatus.approved.value, ReceiptStatus.paid_out.value)
# Any duplicate-family signal: historical_duplicate_*, *_duplicate, cross_seller_duplicate.
_HAS_DUPLICATE_SIGNAL = func.jsonb_path_exists(
    Receipt.fraud_signals, literal_column("""'$[*] ? (@.signal like_regex "duplicate")'::jsonpath""")
)


def _count_if(condition: ColumnElement[bool]) -> ColumnElement[int]:
    return func.count().filter(condition)


def receipt_stats_subquery(now: datetime | None = None):
    """One row per seller_id with receipt counters (non-deleted receipts only)."""
    since = (now or func.now()) - timedelta(days=ACTIVITY_WINDOW_DAYS)
    return (
        select(
            Receipt.seller_id.label("seller_id"),
            func.count().label("receipts_total"),
            _count_if(Receipt.status.in_(_APPROVED)).label("receipts_approved"),
            _count_if(Receipt.status == ReceiptStatus.rejected.value).label("receipts_rejected"),
            _count_if(Receipt.status == ReceiptStatus.on_review.value).label("receipts_on_review"),
            _count_if(Receipt.created_at >= since).label("receipts_30d"),
            _count_if(_HAS_DUPLICATE_SIGNAL).label("receipts_duplicates"),
            func.min(Receipt.created_at).label("first_receipt_at"),
            func.max(Receipt.created_at).label("last_receipt_at"),
        )
        .where(Receipt.is_deleted.is_(False))
        .group_by(Receipt.seller_id)
        .subquery("seller_receipt_stats")
    )


def risk_score_expr(stats) -> ColumnElement[int]:
    """SQL expression of the 0..100 risk score over ``receipt_stats_subquery`` columns."""
    decided = stats.c.receipts_approved + stats.c.receipts_rejected
    reject_rate = func.coalesce(cast(stats.c.receipts_rejected, Numeric) / func.nullif(decided, 0), 0)
    duplicate_rate = func.coalesce(
        cast(stats.c.receipts_duplicates, Numeric) / func.nullif(stats.c.receipts_total, 0), 0
    )
    return cast(func.round(100 * (W_REJECT * reject_rate + W_DUPLICATE * duplicate_rate)), Integer)


def risk_level_filter(score: ColumnElement[int], level: str) -> ColumnElement[bool]:
    if level == "high":
        return score >= RISK_HIGH
    if level == "medium":
        return and_(score >= RISK_MEDIUM, score < RISK_HIGH)
    return score < RISK_MEDIUM


def risk_level(score: int) -> str:
    if score >= RISK_HIGH:
        return "high"
    if score >= RISK_MEDIUM:
        return "medium"
    return "low"


def risk_flags(*, total: int, approved: int, rejected: int, duplicates: int) -> list[str]:
    """Human-meaningful reasons behind the score (codes; the UI renders labels)."""
    flags: list[str] = []
    decided = approved + rejected
    if decided < RISK_MIN_DECISIONS:
        flags.append("low_data")
    elif rejected / decided >= HIGH_REJECT_RATE:
        flags.append("high_reject_rate")
    if total and duplicates / total >= HIGH_DUPLICATE_RATE:
        flags.append("duplicates")
    return flags


def build_stats(row, *, score: int) -> SellerStats:
    """Map a row carrying ``receipt_stats_subquery`` columns (possibly NULL) to the DTO."""
    total = row.receipts_total or 0
    approved = row.receipts_approved or 0
    rejected = row.receipts_rejected or 0
    duplicates = row.receipts_duplicates or 0
    return SellerStats(
        receipts_total=total,
        receipts_approved=approved,
        receipts_rejected=rejected,
        receipts_on_review=row.receipts_on_review or 0,
        receipts_30d=row.receipts_30d or 0,
        receipts_duplicates=duplicates,
        first_receipt_at=row.first_receipt_at,
        last_receipt_at=row.last_receipt_at,
        risk_score=score,
        risk_level=risk_level(score),
        risk_flags=risk_flags(total=total, approved=approved, rejected=rejected, duplicates=duplicates),
    )


async def get_seller_stats(session: AsyncSession, seller_id: int) -> SellerStats:
    stats = receipt_stats_subquery()
    stmt: Select = select(stats, risk_score_expr(stats).label("risk_score")).where(stats.c.seller_id == seller_id)
    row = (await session.execute(stmt)).one_or_none()
    if row is None:
        return SellerStats(risk_flags=["low_data"])
    return build_stats(row, score=row.risk_score or 0)


async def get_seller_weekly_activity(session: AsyncSession, seller_id: int) -> list[SellerWeekActivity]:
    """Receipts uploaded / approved per ISO week for the last WEEKS_OF_HISTORY weeks (oldest first)."""
    week = func.date_trunc("week", Receipt.created_at)
    since = func.date_trunc("week", func.now()) - timedelta(weeks=WEEKS_OF_HISTORY - 1)
    stmt = (
        select(
            week.label("week_start"),
            func.count().label("receipts"),
            _count_if(Receipt.status.in_(_APPROVED)).label("approved"),
        )
        .where(Receipt.seller_id == seller_id, Receipt.is_deleted.is_(False), Receipt.created_at >= since)
        .group_by(week)
        .order_by(week)
    )
    rows = (await session.execute(stmt)).all()
    return [SellerWeekActivity(week_start=r.week_start.date(), receipts=r.receipts, approved=r.approved) for r in rows]


async def get_seller_avg_bonus(session: AsyncSession, seller_id: int) -> int:
    stmt = select(cast(func.coalesce(func.avg(cast(Receipt.bonus_amount, Float)), 0), Integer)).where(
        Receipt.seller_id == seller_id,
        Receipt.is_deleted.is_(False),
        Receipt.status.in_(_APPROVED),
    )
    return int((await session.execute(stmt)).scalar_one() or 0)
