"""Worker step for QR-intake receipts: no files, no OCR.

pending → fraud signals (date window, same-seller and cross-seller duplicates —
signals only, BRD В-3-A) → on_review → first OFD verification attempt. Moderation
stays manual; the bonus is set by the admin (BRD: no automatic bonus).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.fraud.checks import FraudChecker
from src.receipt.models import EventKind, Receipt, ReceiptStatus
from src.receipt_intake.fiscal import FiscalValidationError, parse_qr
from src.receipt_journey import service as journey
from src.receipt_verification.providers import ProviderRegistry
from src.receipt_verification.service import run_round

logger = logging.getLogger(__name__)
_checker = FraudChecker()

# A QR receipt still `pending` this long after creation lost its worker job
# (worker crash, Redis flush) — the cron re-runs the step for it.
STUCK_PENDING_AFTER = timedelta(minutes=10)


async def _signals(session: AsyncSession, receipt: Receipt) -> list[dict]:
    signals: list[dict] = []
    try:
        data = parse_qr(receipt.qr_raw or "")
    except FiscalValidationError:
        data = None
    if data is not None:
        old = _checker.check_date_window(data.purchase_at)
        if old is not None:
            signals.append(old.to_dict())
    if receipt.fn and receipt.fd and receipt.fp:
        cross = await _checker.check_cross_seller_duplicate(
            session, receipt.fn, receipt.fd, receipt.fp, receipt.seller_id, qr_only=True
        )
        if cross is not None:
            signals.append(cross.to_dict())
        own = (
            await session.execute(
                select(Receipt.id)
                .where(
                    Receipt.fn == receipt.fn,
                    Receipt.fd == receipt.fd,
                    Receipt.fp == receipt.fp,
                    Receipt.seller_id == receipt.seller_id,
                    Receipt.id != receipt.id,
                    Receipt.is_deleted.is_(False),
                    Receipt.source.is_not(None),  # QR-intake receipts only (BRD В-17)
                )
                .order_by(Receipt.id)
                .limit(1)
            )
        ).scalar_one_or_none()
        if own is not None:
            signals.append(FraudChecker.historical_duplicate_signal(own, kind="fn_fd_fp").to_dict())
    return signals


async def process_qr_receipt(session: AsyncSession, receipt_id: int, registry: ProviderRegistry) -> None:
    async with session.begin():
        receipt = (
            await session.execute(select(Receipt).where(Receipt.id == receipt_id).with_for_update())
        ).scalar_one_or_none()
        if receipt is None or receipt.status != ReceiptStatus.pending.value:
            logger.info("qr_intake.skip, receipt_id=%d", receipt_id)  # retried job / already processed
            return
        signals = await _signals(session, receipt)
        receipt.fraud_signals = [*(receipt.fraud_signals or []), *signals]
        receipt.status = ReceiptStatus.on_review.value
        if signals:
            await journey.record(
                session, receipt_id, EventKind.risk_flagged, actor_type="system",
                data={"signals": [s["signal"] for s in signals]},
            )
        await journey.record(session, receipt_id, EventKind.sent_to_moderation, actor_type="system")
    await run_round(session, receipt_id, registry, trigger="pipeline")


async def stuck_pending_ids(session: AsyncSession, *, now: datetime | None = None, limit: int = 25) -> list[int]:
    cutoff = (now or datetime.now(UTC)) - STUCK_PENDING_AFTER
    rows = await session.execute(
        select(Receipt.id)
        .where(
            Receipt.source.is_not(None),
            Receipt.status == ReceiptStatus.pending.value,
            Receipt.created_at < cutoff,
            Receipt.is_deleted.is_(False),
        )
        .order_by(Receipt.id)
        .limit(limit)
    )
    ids = list(rows.scalars())
    await session.commit()
    return ids
