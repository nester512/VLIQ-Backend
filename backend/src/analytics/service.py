"""Admin dashboard aggregates (A4 / UC-01).

The admin UI used to derive these numbers client-side from the first 200 rows of
the list endpoints, so on real volumes every counter except the totals was wrong.
Every metric here is one SQL aggregate over the whole database.

Semantics (kept identical to what the dashboard showed before, just correct):
- sellers_active      — status = 'active';
- receipts_*          — non-deleted receipts; "on review" = status 'on_review'
                        (the same set the review queue shows);
- payouts_pending     — requests in new / in_progress;
- payouts_paid_month  — requests with status 'paid' whose updated_at (= moment of
                        the paid transition) falls in the current calendar month;
- avg_check           — mean total_sum over approved (approved + paid_out) receipts;
- daily_receipts      — uploads per day for the last DAILY_DAYS days, zero-filled;
- top_sellers         — by approved desc, total desc; sales = Σ total_sum of approved,
                        paid = Σ amount of paid payout requests;
- top_products        — Σ qty per item name over approved receipts.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Integer, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.analytics.schemas.api import AdminDashboard, DashboardDay, DashboardTopProduct, DashboardTopSeller
from src.payout_request.models import PayoutRequest, PayoutRequestStatus
from src.receipt.models import Receipt, ReceiptStatus
from src.seller.models import Seller, SellerStatus

DAILY_DAYS = 30
TOP_SELLERS_LIMIT = 25
TOP_PRODUCTS_LIMIT = 15

_APPROVED = (ReceiptStatus.approved.value, ReceiptStatus.paid_out.value)
_PAYOUT_PENDING = (PayoutRequestStatus.new.value, PayoutRequestStatus.in_progress.value)
_LIVE = Receipt.is_deleted.is_(False)

# DAILY_DAYS is a module constant (never user input), inlined so asyncpg needs no date arithmetic on a bind param.
_DAILY_SQL = text(
    f"""
    SELECT d::date AS day, COALESCE(c.n, 0) AS receipts
    FROM generate_series(current_date - {DAILY_DAYS - 1}, current_date, interval '1 day') AS d
    LEFT JOIN (
        SELECT created_at::date AS day, count(*) AS n
        FROM vliq.receipt
        WHERE is_deleted = false AND created_at >= current_date - {DAILY_DAYS - 1}
        GROUP BY 1
    ) c ON c.day = d::date
    ORDER BY d
    """
)

_TOP_PRODUCTS_SQL = text(
    """
    SELECT name, sum(qty) AS count
    FROM (
        SELECT COALESCE(NULLIF(btrim(it->>'raw_name'), ''), NULLIF(btrim(it->>'name'), ''), '—') AS name,
               -- OCR/OFD may put text like "2 шт" or "1,5" into qty: count it as 1, never 500.
               CASE WHEN it->>'qty' ~ '^[0-9]+([.][0-9]+)?$' THEN (it->>'qty')::numeric ELSE 1 END AS qty
        FROM vliq.receipt r
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(r.items) = 'array' THEN r.items ELSE '[]'::jsonb END
        ) AS it
        WHERE r.is_deleted = false AND r.status IN ('approved', 'paid_out')
    ) items
    GROUP BY name
    ORDER BY count DESC, name
    LIMIT :limit
    """
)


async def _sellers_counts(session: AsyncSession) -> tuple[int, int]:
    stmt = select(func.count(), func.count().filter(Seller.status == SellerStatus.active.value))
    total, active = (await session.execute(stmt)).one()
    return int(total), int(active)


async def _receipts_counts(session: AsyncSession) -> tuple[int, int, int]:
    approved_sum = func.avg(Receipt.total_sum).filter(Receipt.status.in_(_APPROVED), Receipt.total_sum.is_not(None))
    stmt = select(
        func.count(),
        func.count().filter(Receipt.status == ReceiptStatus.on_review.value),
        cast(func.round(func.coalesce(approved_sum, 0)), Integer),
    ).where(_LIVE)
    total, on_review, avg_check = (await session.execute(stmt)).one()
    return int(total), int(on_review), int(avg_check or 0)


async def _payouts_counts(session: AsyncSession) -> tuple[int, int, int, int]:
    pending = PayoutRequest.status.in_(_PAYOUT_PENDING)
    paid_month = (PayoutRequest.status == PayoutRequestStatus.paid.value) & (
        PayoutRequest.updated_at >= func.date_trunc("month", func.now())
    )
    stmt = select(
        func.count().filter(pending),
        func.coalesce(func.sum(PayoutRequest.amount).filter(pending), 0),
        func.count().filter(paid_month),
        func.coalesce(func.sum(PayoutRequest.amount).filter(paid_month), 0),
    )
    row = (await session.execute(stmt)).one()
    return int(row[0]), int(row[1]), int(row[2]), int(row[3])


async def _daily_receipts(session: AsyncSession) -> list[DashboardDay]:
    rows = (await session.execute(_DAILY_SQL)).all()
    return [DashboardDay(day=r.day, receipts=int(r.receipts)) for r in rows]


async def _top_sellers(session: AsyncSession) -> list[DashboardTopSeller]:
    approved = Receipt.status.in_(_APPROVED)
    receipts = (
        select(
            Receipt.seller_id.label("seller_id"),
            func.count().label("total"),
            func.count().filter(approved).label("approved"),
            func.coalesce(func.sum(Receipt.total_sum).filter(approved), 0).label("sales"),
        )
        .where(_LIVE)
        .group_by(Receipt.seller_id)
        .subquery("r")
    )
    paid = (
        select(PayoutRequest.seller_id.label("seller_id"), func.sum(PayoutRequest.amount).label("paid"))
        .where(PayoutRequest.status == PayoutRequestStatus.paid.value)
        .group_by(PayoutRequest.seller_id)
        .subquery("p")
    )
    stmt = (
        select(
            Seller.telegram_id,
            Seller.first_name,
            Seller.last_name,
            Seller.city,
            receipts.c.total,
            receipts.c.approved,
            receipts.c.sales,
            func.coalesce(paid.c.paid, 0).label("paid"),
        )
        .join(receipts, receipts.c.seller_id == Seller.telegram_id)
        .outerjoin(paid, paid.c.seller_id == Seller.telegram_id)
        .order_by(receipts.c.approved.desc(), receipts.c.total.desc(), Seller.telegram_id)
        .limit(TOP_SELLERS_LIMIT)
    )
    result = []
    for r in (await session.execute(stmt)).all():
        name = " ".join(p for p in (r.first_name, r.last_name) if p) or f"Продавец #{r.telegram_id}"
        result.append(
            DashboardTopSeller(
                telegram_id=r.telegram_id,
                name=name,
                city=r.city,
                receipts_total=int(r.total),
                receipts_approved=int(r.approved),
                sales=int(r.sales),
                paid=int(r.paid),
            )
        )
    return result


async def _top_products(session: AsyncSession) -> list[DashboardTopProduct]:
    rows = (await session.execute(_TOP_PRODUCTS_SQL, {"limit": TOP_PRODUCTS_LIMIT})).all()
    return [DashboardTopProduct(name=r.name, count=float(r.count)) for r in rows]


async def get_admin_dashboard(session: AsyncSession) -> AdminDashboard:
    sellers_total, sellers_active = await _sellers_counts(session)
    receipts_total, receipts_on_review, avg_check = await _receipts_counts(session)
    pending, pending_amount, paid_month, paid_month_amount = await _payouts_counts(session)
    return AdminDashboard(
        sellers_total=sellers_total,
        sellers_active=sellers_active,
        receipts_total=receipts_total,
        receipts_on_review=receipts_on_review,
        payouts_pending=pending,
        payouts_pending_amount=pending_amount,
        payouts_paid_month=paid_month,
        payouts_paid_month_amount=paid_month_amount,
        avg_check=avg_check,
        daily_receipts=await _daily_receipts(session),
        top_sellers=await _top_sellers(session),
        top_products=await _top_products(session),
        generated_at=datetime.now(UTC),
    )
