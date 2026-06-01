"""Anti-fraud checks for the receipt processing pipeline.

Each check returns the *first* conflicting Receipt ORM object (or None) and/or
raises / returns a FraudSignal if a fraud condition is detected.

All DB queries use the async SQLAlchemy session — no synchronous I/O.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.fraud.signals import (
    SEVERITY_CRITICAL,
    SEVERITY_HIGH,
    SEVERITY_LOW,
    SEVERITY_MEDIUM,
    FraudSignal,
)
from src.receipt.models import Receipt

logger = logging.getLogger(__name__)


class FraudChecker:
    """Collection of receipt fraud checks.

    All methods are async and accept an open :class:`~sqlalchemy.ext.asyncio.AsyncSession`.
    They return the duplicate :class:`~src.receipt.models.Receipt` when found, or ``None``.
    """

    # --- Duplicate detection ------------------------------------------------

    async def check_file_hash(self, session: AsyncSession, file_hash: str) -> Receipt | None:
        """Check if a receipt with this file_hash already exists (non-deleted).

        Returns the existing Receipt ORM object or None.
        """
        stmt = select(Receipt).where(Receipt.file_hash == file_hash, Receipt.is_deleted.is_(False)).limit(1)
        result = await session.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing is not None:
            logger.info(
                "fraud.file_hash_duplicate, existing_id=%d, hash=%s",
                existing.id,
                file_hash[:16],
            )
        return existing

    async def check_qr_raw(self, session: AsyncSession, qr_raw: str) -> Receipt | None:
        """Check if a receipt with the same raw QR string exists (non-deleted)."""
        stmt = select(Receipt).where(Receipt.qr_raw == qr_raw, Receipt.is_deleted.is_(False)).limit(1)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    async def check_fn_fd_fp(self, session: AsyncSession, fn: str, fd: str, fp: str) -> Receipt | None:
        """Check if a receipt with the same fiscal (fn, fd, fp) triple exists.

        Note: The partial UNIQUE index (defined in migration 0001_initial) prevents
        hard duplicates, but we check here to produce a fraud signal before hitting
        the DB constraint.
        """
        stmt = (
            select(Receipt)
            .where(
                Receipt.fn == fn,
                Receipt.fd == fd,
                Receipt.fp == fp,
                Receipt.is_deleted.is_(False),
            )
            .limit(1)
        )
        result = await session.execute(stmt)
        return result.scalar_one_or_none()

    # --- Date window check --------------------------------------------------

    def check_date_window(self, purchase_date: datetime, *, max_age_days: int = 30) -> FraudSignal | None:
        """Return a FraudSignal if *purchase_date* is older than *max_age_days*.

        Args:
            purchase_date: Timezone-aware purchase datetime from QR/OFD.
            max_age_days: Maximum allowed receipt age in days (default 30).

        Returns:
            :class:`~src.fraud.signals.FraudSignal` or ``None`` if within window.
        """
        if purchase_date.tzinfo is None:
            purchase_date = purchase_date.replace(tzinfo=UTC)
        now = datetime.now(tz=UTC)
        age = now - purchase_date
        if age > timedelta(days=max_age_days):
            logger.info(
                "fraud.date_window_exceeded, age_days=%.1f, max=%d",
                age.days,
                max_age_days,
            )
            return FraudSignal(
                signal="receipt_too_old",
                severity=SEVERITY_HIGH,
                details={"age_days": age.days, "max_age_days": max_age_days},
            )
        return None

    # --- Cross-seller duplicate ---------------------------------------------

    async def check_cross_seller_duplicate(
        self,
        session: AsyncSession,
        fn: str,
        fd: str,
        fp: str,
        current_seller_id: int,
    ) -> FraudSignal | None:
        """Detect if the same fiscal receipt was uploaded by a *different* seller.

        This indicates the same physical receipt is being shared/sold between
        sellers to farm bonuses.

        Args:
            session: Async DB session.
            fn: Fiscal number from QR/OFD.
            fd: Fiscal document number.
            fp: Fiscal sign.
            current_seller_id: Seller who is currently uploading.

        Returns:
            :class:`~src.fraud.signals.FraudSignal` with ``signal='cross_seller_duplicate'``
            or ``None`` if no conflict found.
        """
        stmt = (
            select(Receipt)
            .where(
                Receipt.fn == fn,
                Receipt.fd == fd,
                Receipt.fp == fp,
                Receipt.seller_id != current_seller_id,
                Receipt.is_deleted.is_(False),
            )
            .limit(1)
        )
        result = await session.execute(stmt)
        conflicting = result.scalar_one_or_none()
        if conflicting is None:
            return None

        logger.warning(
            "fraud.cross_seller_duplicate, fn=%s fd=%s fp=%s, existing_seller=%d, current_seller=%d, existing_id=%d",
            fn,
            fd,
            fp,
            conflicting.seller_id,
            current_seller_id,
            conflicting.id,
        )
        return FraudSignal(
            signal="cross_seller_duplicate",
            severity=SEVERITY_CRITICAL,
            duplicate_of_id=conflicting.id,
            details={
                "fn": fn,
                "fd": fd,
                "fp": fp,
                "existing_seller_id": conflicting.seller_id,
            },
        )

    # --- Signal builders (convenience) -------------------------------------

    @staticmethod
    def file_hash_signal(existing_id: int) -> FraudSignal:
        return FraudSignal(
            signal="file_hash_duplicate",
            severity=SEVERITY_HIGH,
            duplicate_of_id=existing_id,
        )

    @staticmethod
    def qr_raw_signal(existing_id: int) -> FraudSignal:
        return FraudSignal(
            signal="qr_raw_duplicate",
            severity=SEVERITY_HIGH,
            duplicate_of_id=existing_id,
        )

    @staticmethod
    def fn_fd_fp_signal(existing_id: int) -> FraudSignal:
        return FraudSignal(
            signal="fn_fd_fp_duplicate",
            severity=SEVERITY_HIGH,
            duplicate_of_id=existing_id,
        )

    @staticmethod
    def qr_ofd_mismatch_signal(*, qr_sum: int, ofd_sum: int) -> FraudSignal:
        return FraudSignal(
            signal="qr_ofd_sum_mismatch",
            severity=SEVERITY_MEDIUM,
            details={"qr_sum_kop": qr_sum, "ofd_sum_kop": ofd_sum},
        )

    @staticmethod
    def no_sku_match_signal() -> FraudSignal:
        return FraudSignal(
            signal="no_sku_match",
            severity=SEVERITY_LOW,
        )
