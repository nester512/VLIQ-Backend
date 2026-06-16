"""Receipt processing pipeline orchestrator.

Executes all processing steps sequentially; each step emits a structured log.
On failure, updates the receipt status and stores fraud signals.

Step order (per 06-ocr-plan.md § 4):
    1.  Update status → ocr_in_progress
    2.  QR extract
    3.  Fraud: qr_raw + fn/fd/fp duplicate check + date window
    4.  OFD call (cache-first) — with configurable retry/timeout
    5.  Cross-verify QR total vs OFD total
    6.  SKU match
    7.  Bonus calculation
    8.  Atomic commit: UPDATE receipt + INSERT bonus_transaction
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.app.prometheus_metrics import receipt_pipeline_duration_seconds
from src.bonus_engine.engine import calculate_bonus
from src.bonus_engine.schemas import ReceiptItemContext, RuleContext
from src.fraud.checks import FraudChecker
from src.fraud.signals import FraudSignal
from src.ofd_client.base import OFDClientProtocol
from src.ofd_client.cache import OFDCache
from src.ofd_client.exceptions import OFDBlockedError, OFDNotFoundError, OFDRateLimitError
from src.promotion.models import Promotion, PromotionStatus
from src.receipt.models import Receipt, ReceiptStatus
from src.receipt_ocr.qr_extractor import QRExtractor
from src.receipt_ocr.qr_parser import QRParseError, parse_qr_string
from src.receipt_ocr.storage import LocalFileStorage, ReceiptStorage
from src.receipt_pipeline.state_machine import ReceiptStateMachine
from src.receipt_pipeline.steps import PipelineResult, StepError
from src.sku.models import Sku
from src.sku_matcher.matcher import SkuMatcher

logger = logging.getLogger(__name__)

_SM = ReceiptStateMachine()

# Max allowed total_sum deviation between QR and OFD (1%).
_MAX_SUM_DEVIATION_PERCENT = 1.0

# Machine-readable rejection code set when OFD upstream is exhausted.
_OFD_UPSTREAM_UNAVAILABLE = "OFD_UPSTREAM_UNAVAILABLE"

# Default retry backoff delays (seconds): attempt 1→2: 1s, 2→3: 2s, 3→4: 4s.
_RETRY_BACKOFF = (1.0, 2.0, 4.0)


def _get_retry_config() -> tuple[int, list[float]]:
    """Return (max_attempts, backoff_delays) from env vars or defaults.

    Env vars:
        OFD_RETRY_MAX_ATTEMPTS — total attempts including first try (default 3).
        OFD_TIMEOUT_SECONDS    — consulted by the OFD client directly; not used here.
    """
    try:
        max_attempts = int(os.environ.get("OFD_RETRY_MAX_ATTEMPTS", "3"))
    except ValueError:
        max_attempts = 3
    # Build backoff list: one delay per inter-attempt gap (max_attempts - 1).
    delays = list(_RETRY_BACKOFF[: max(0, max_attempts - 1)])
    return max_attempts, delays


class ReceiptPipelineOrchestrator:
    """Orchestrates the receipt OCR → OFD → bonus pipeline.

    All dependencies are injected for testability.

    Args:
        ofd_client: OFD provider (ProverkachekaClient or FakeOFDClient).
        ofd_cache: Redis or in-memory OFD response cache.
        qr_extractor: QR code extractor.
        sku_matcher: SKU name matcher.
        fraud_checker: Anti-fraud checks.
        storage: File storage backend (for fetching image bytes when needed).
    """

    def __init__(  # noqa: PLR0913
        self,
        *,
        ofd_client: OFDClientProtocol,
        ofd_cache: OFDCache,
        qr_extractor: QRExtractor,
        sku_matcher: SkuMatcher,
        fraud_checker: FraudChecker,
        ocr_mode: str = "full",
        storage: ReceiptStorage | None = None,
    ) -> None:
        self._ofd_client = ofd_client
        self._ofd_cache = ofd_cache
        self._qr_extractor = qr_extractor
        self._sku_matcher = sku_matcher
        self._fraud_checker = fraud_checker
        self._ocr_mode = ocr_mode
        # Storage backend used to fetch image bytes during QR extraction.
        self._storage: ReceiptStorage = storage if storage is not None else LocalFileStorage()

    async def process(self, receipt_id: int, session: AsyncSession) -> None:
        """Run the full pipeline for *receipt_id*.

        This method is designed to be called from an arq worker.
        All exceptions are caught internally — the receipt status is updated
        to reflect the failure mode.

        Args:
            receipt_id: PK of the Receipt to process.
            session: Async SQLAlchemy session (worker provides its own).
        """
        t_start = time.monotonic()
        result = PipelineResult()

        # Load receipt first so we can log real file_size / has_qr.
        receipt = await self._load_receipt(session, receipt_id)
        if receipt is None:
            logger.error(
                "pipeline.receipt_not_found",
                extra={"receipt_id": receipt_id},
            )
            return

        logger.info(
            "pipeline.start",
            extra={
                "receipt_id": receipt_id,
                "brand_id": receipt.brand_id,
                "has_qr": bool(receipt.qr_raw),
                "file_url": (receipt.file_url or "")[:80],
                "ocr_mode": self._ocr_mode,
            },
        )

        # Demo mode: skip QR/OFD, set on_review with fixed bonus.
        if self._ocr_mode == "demo":
            await self._process_demo(session, receipt)
            duration_ms = int((time.monotonic() - t_start) * 1000)
            logger.info(
                "pipeline.complete",
                extra={"receipt_id": receipt_id, "final_status": "on_review", "total_duration_ms": duration_ms},
            )
            return

        try:
            # Step 1: ocr_in_progress
            await self._step_set_status(session, receipt, "ocr_in_progress")

            # Step 2: QR extraction.
            await self._step_qr_extract(session, receipt, result)

            # Step 3: Fraud — qr/fn duplicate + date window.
            await self._step_fraud_early(session, receipt, result)

            # Step 4: OFD call (cache-first, with retry).
            await self._step_ofd_fetch(session, receipt, result)

            # Step 5: QR vs OFD cross-verify.
            await self._step_verify_qr_vs_ofd(session, receipt, result)

            # Step 6: SKU match.
            skus = await self._load_skus(session, receipt.brand_id)
            await self._step_sku_match(session, receipt, result, skus)

            # Step 7: Bonus calculation.
            promotions = await self._load_active_promotions(session, receipt)
            seller_count = await self._count_seller_receipts(session, receipt)
            await self._step_bonus_calc(receipt, result, skus, promotions, seller_count)

            # Step 8: Persist enrichment + suggested bonus, route to on_review (admin decides).
            await self._step_finalize_review(session, receipt, result)

            _duration = time.monotonic() - t_start
            receipt_pipeline_duration_seconds.labels(status=ReceiptStatus.on_review.value).observe(_duration)
            logger.info(
                "pipeline.complete",
                extra={
                    "receipt_id": receipt_id,
                    "final_status": ReceiptStatus.on_review.value,
                    "total_duration_ms": int(_duration * 1000),
                },
            )

        except StepError as exc:
            await self._handle_step_error(session, receipt, result, exc)
            _duration = time.monotonic() - t_start
            receipt_pipeline_duration_seconds.labels(status=exc.new_status).observe(_duration)
            logger.info(
                "pipeline.complete",
                extra={
                    "receipt_id": receipt_id,
                    "final_status": exc.new_status,
                    "total_duration_ms": int(_duration * 1000),
                },
            )

        except Exception as exc:
            logger.exception("pipeline.unexpected_error", extra={"receipt_id": receipt_id, "error": str(exc)})
            await self._set_status_with_signals(session, receipt, ReceiptStatus.on_review.value, result.fraud_signals)
            _duration = time.monotonic() - t_start
            receipt_pipeline_duration_seconds.labels(status="error").observe(_duration)
            logger.info(
                "pipeline.complete",
                extra={
                    "receipt_id": receipt_id,
                    "final_status": ReceiptStatus.on_review.value,
                    "total_duration_ms": int(_duration * 1000),
                },
            )

    # -------------------------------------------------------------------------
    # Demo mode
    # -------------------------------------------------------------------------

    async def _process_demo(self, session: AsyncSession, receipt: Receipt) -> None:
        """Demo pipeline: skip OCR/OFD, immediately set on_review for manual review.

        Adds a demo fraud signal so reviewers know OCR was skipped. Per spec S8
        there is NO automatic bonus — the admin assigns the bonus on approve, so
        the suggested bonus_amount stays 0 here.
        """
        demo_signal = {
            "signal": "demo_mode",
            "severity": "low",
            "details": "OCR skipped — manual review only",
        }
        vals = {
            "status": ReceiptStatus.on_review.value,
            "fraud_signals": [demo_signal],
            # S8: no auto/fixed bonus — admin assigns it on approve.
            "bonus_amount": 0,
            "rejection_reason": None,
        }
        try:
            await session.execute(update(Receipt).where(Receipt.id == receipt.id).values(**vals))
            await session.commit()
            logger.info(
                "pipeline.demo_on_review, receipt_id=%d (no auto bonus — admin assigns)",
                receipt.id,
            )
        except Exception as exc:
            logger.exception("pipeline.demo_commit_failed, receipt_id=%d: %s", receipt.id, exc)

    # -------------------------------------------------------------------------
    # Step implementations
    # -------------------------------------------------------------------------

    async def _step_set_status(self, session: AsyncSession, receipt: Receipt, new_status: str) -> None:
        t0 = time.monotonic()
        if not _SM.can_transition(from_status=receipt.status, to_status=new_status, actor="system"):
            raise StepError(
                step="set_status",
                reason=f"Transition {receipt.status} → {new_status} not allowed",
                new_status=ReceiptStatus.on_review.value,
            )
        await session.execute(update(Receipt).where(Receipt.id == receipt.id).values(status=new_status))
        await session.flush()
        receipt.status = new_status
        logger.info(
            "pipeline.step_set_status",
            extra={
                "receipt_id": receipt.id,
                "status": new_status,
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )

    async def _step_qr_extract(self, session: AsyncSession, receipt: Receipt, result: PipelineResult) -> None:
        t0 = time.monotonic()
        # If the receipt already has a qr_raw (submitted via /qr-payload), skip
        # image-based extraction and parse it directly.
        if receipt.qr_raw:
            try:
                result.parsed_qr = parse_qr_string(receipt.qr_raw)
                result.qr_raw = receipt.qr_raw
            except QRParseError as exc:
                raise StepError(
                    step="qr_parse",
                    reason=f"QR string parse failed: {exc}",
                    new_status=ReceiptStatus.on_review.value,
                ) from exc
            duration_ms = int((time.monotonic() - t0) * 1000)
            logger.info(
                "pipeline.qr_extracted",
                extra={
                    "receipt_id": receipt.id,
                    "qr_raw": (receipt.qr_raw or "")[:80],
                    "source": "db",
                    "duration_ms": duration_ms,
                },
            )
            return

        qr_raw: str | None = None
        file_bytes: bytes | None = await self._try_load_file_via_storage(receipt.file_url)
        if file_bytes is not None:
            qr_raw = await self._qr_extractor.extract(file_bytes)

        duration_ms = int((time.monotonic() - t0) * 1000)

        if qr_raw is None:
            logger.info(
                "pipeline.qr_extraction_failed",
                extra={"receipt_id": receipt.id, "duration_ms": duration_ms},
            )
            raise StepError(
                step="qr_extract",
                reason="QR code not readable from image",
                new_status=ReceiptStatus.on_review.value,
            )

        logger.info(
            "pipeline.qr_extracted",
            extra={
                "receipt_id": receipt.id,
                "qr_raw": qr_raw[:80],
                "duration_ms": duration_ms,
            },
        )

        try:
            result.parsed_qr = parse_qr_string(qr_raw)
        except QRParseError as exc:
            raise StepError(
                step="qr_parse",
                reason=f"QR string parse failed: {exc}",
                new_status=ReceiptStatus.on_review.value,
            ) from exc

        result.qr_raw = qr_raw

    async def _step_fraud_early(self, session: AsyncSession, receipt: Receipt, result: PipelineResult) -> None:
        """Check for QR-based duplicates and date window violations."""
        t0 = time.monotonic()
        pqr = result.parsed_qr
        if pqr is None:
            return

        # Check qr_raw duplicate.
        dup = await self._fraud_checker.check_qr_raw(session, result.qr_raw or "")
        if dup is not None and dup.id != receipt.id:
            result.fraud_signals.append(self._fraud_checker.qr_raw_signal(dup.id))
            raise StepError(
                step="fraud_qr_raw",
                reason=f"QR already used in receipt #{dup.id}",
                new_status=ReceiptStatus.on_review.value,
            )

        # Check fn/fd/fp duplicate.
        dup2 = await self._fraud_checker.check_fn_fd_fp(session, pqr.fn, pqr.fd, pqr.fp)
        if dup2 is not None and dup2.id != receipt.id:
            result.fraud_signals.append(self._fraud_checker.fn_fd_fp_signal(dup2.id))
            raise StepError(
                step="fraud_fn_fd_fp",
                reason=f"Fiscal triple already used in receipt #{dup2.id}",
                new_status=ReceiptStatus.on_review.value,
            )

        # Date window check.
        date_signal = self._fraud_checker.check_date_window(pqr.purchase_date)
        if date_signal is not None:
            result.fraud_signals.append(date_signal)
            raise StepError(
                step="fraud_date_window",
                reason="Purchase date is too old",
                new_status=ReceiptStatus.on_review.value,
            )

        # Cross-seller duplicate check (non-fatal — becomes on_review signal).
        cross = await self._fraud_checker.check_cross_seller_duplicate(
            session, pqr.fn, pqr.fd, pqr.fp, receipt.seller_id
        )
        if cross is not None:
            result.fraud_signals.append(cross)
            raise StepError(
                step="fraud_cross_seller",
                reason="Cross-seller duplicate detected",
                new_status=ReceiptStatus.on_review.value,
            )

        logger.info(
            "pipeline.fraud_early_ok, receipt_id=%d, duration_ms=%d",
            receipt.id,
            int((time.monotonic() - t0) * 1000),
        )

    async def _step_ofd_fetch(self, session: AsyncSession, receipt: Receipt, result: PipelineResult) -> None:
        pqr = result.parsed_qr
        if pqr is None:
            return

        t0 = time.monotonic()
        purchase_date_str = pqr.purchase_date.isoformat()

        # Try cache first.
        cached = await self._ofd_cache.get(pqr.fn, pqr.fd, pqr.fp)
        if cached is not None:
            result.ofd_receipt = cached
            logger.info(
                "pipeline.ofd_cache_hit",
                extra={"receipt_id": receipt.id, "duration_ms": int((time.monotonic() - t0) * 1000)},
            )
            return

        logger.info(
            "pipeline.ofd_call",
            extra={"receipt_id": receipt.id, "fn": pqr.fn, "fd": pqr.fd, "fp": pqr.fp, "total": pqr.total_sum_kop},
        )

        max_attempts, backoff_delays = _get_retry_config()
        ofd_receipt = None

        for attempt in range(1, max_attempts + 1):
            t_attempt = time.monotonic()
            try:
                ofd_receipt = await self._ofd_client.get_receipt(
                    fn=pqr.fn,
                    fd=pqr.fd,
                    fp=pqr.fp,
                    total_sum=pqr.total_sum_kop,
                    purchase_date=purchase_date_str,
                )
                duration_ms = int((time.monotonic() - t_attempt) * 1000)
                logger.info(
                    "pipeline.ofd_response",
                    extra={
                        "receipt_id": receipt.id,
                        "attempt": attempt,
                        "status": "ok",
                        "duration_ms": duration_ms,
                    },
                )
                break  # success — exit retry loop

            except OFDNotFoundError as exc:
                # 404-equivalent — no point retrying.
                duration_ms = int((time.monotonic() - t_attempt) * 1000)
                logger.info(
                    "pipeline.ofd_response",
                    extra={
                        "receipt_id": receipt.id,
                        "attempt": attempt,
                        "status": "not_found",
                        "duration_ms": duration_ms,
                    },
                )
                raise StepError(
                    step="ofd_fetch",
                    reason=f"Receipt not found in OFD: {exc}",
                    new_status=ReceiptStatus.on_review.value,
                ) from exc

            except (OFDRateLimitError, OFDBlockedError) as exc:
                # 429 / transient block — retry with backoff.
                duration_ms = int((time.monotonic() - t_attempt) * 1000)
                logger.warning(
                    "pipeline.ofd_transient_error",
                    extra={
                        "receipt_id": receipt.id,
                        "attempt": attempt,
                        "max_attempts": max_attempts,
                        "error": type(exc).__name__,
                        "duration_ms": duration_ms,
                    },
                )
                if attempt < max_attempts:
                    delay = backoff_delays[attempt - 1] if attempt - 1 < len(backoff_delays) else backoff_delays[-1]
                    await asyncio.sleep(delay)
                else:
                    # All retries exhausted — set needs_revision, do not crash.
                    logger.error(
                        "pipeline.ofd_upstream_unavailable",
                        extra={
                            "receipt_id": receipt.id,
                            "rejection_reason": _OFD_UPSTREAM_UNAVAILABLE,
                            "total_attempts": attempt,
                        },
                    )
                    raise StepError(
                        step="ofd_fetch",
                        reason=_OFD_UPSTREAM_UNAVAILABLE,
                        new_status=ReceiptStatus.on_review.value,
                    ) from exc

            except Exception as exc:  # noqa: BLE001
                # Unexpected error (network, serialization) — retry transient errors.
                duration_ms = int((time.monotonic() - t_attempt) * 1000)
                logger.warning(
                    "pipeline.ofd_unexpected_error",
                    extra={
                        "receipt_id": receipt.id,
                        "attempt": attempt,
                        "max_attempts": max_attempts,
                        "error": type(exc).__name__,
                        "duration_ms": duration_ms,
                    },
                )
                if attempt < max_attempts:
                    delay = backoff_delays[attempt - 1] if attempt - 1 < len(backoff_delays) else backoff_delays[-1]
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        "pipeline.ofd_upstream_unavailable",
                        extra={
                            "receipt_id": receipt.id,
                            "rejection_reason": _OFD_UPSTREAM_UNAVAILABLE,
                            "total_attempts": attempt,
                        },
                    )
                    raise StepError(
                        step="ofd_fetch",
                        reason=_OFD_UPSTREAM_UNAVAILABLE,
                        new_status=ReceiptStatus.on_review.value,
                    ) from exc

        if ofd_receipt is None:
            # Should not be reachable, but guard for safety.
            raise StepError(
                step="ofd_fetch",
                reason=_OFD_UPSTREAM_UNAVAILABLE,
                new_status=ReceiptStatus.on_review.value,
            )

        # Store in cache (non-fatal if Redis is unavailable).
        await self._ofd_cache.set(pqr.fn, pqr.fd, pqr.fp, ofd_receipt)
        result.ofd_receipt = ofd_receipt

        total_duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "pipeline.ofd_fetched",
            extra={
                "receipt_id": receipt.id,
                "items": len(ofd_receipt.items),
                "total_duration_ms": total_duration_ms,
            },
        )

    async def _step_verify_qr_vs_ofd(self, session: AsyncSession, receipt: Receipt, result: PipelineResult) -> None:
        pqr = result.parsed_qr
        ofd = result.ofd_receipt
        if pqr is None or ofd is None:
            return

        t0 = time.monotonic()
        deviation = abs(pqr.total_sum_kop - ofd.total_sum)
        tolerance = ofd.total_sum * _MAX_SUM_DEVIATION_PERCENT / 100.0
        if deviation > max(tolerance, 1):
            signal = self._fraud_checker.qr_ofd_mismatch_signal(qr_sum=pqr.total_sum_kop, ofd_sum=ofd.total_sum)
            result.fraud_signals.append(signal)
            raise StepError(
                step="verify_qr_vs_ofd",
                reason=f"QR sum {pqr.total_sum_kop} kopecks != OFD sum {ofd.total_sum} kopecks",
                new_status=ReceiptStatus.on_review.value,
            )

        logger.info(
            "pipeline.qr_ofd_verify_ok, receipt_id=%d, duration_ms=%d",
            receipt.id,
            int((time.monotonic() - t0) * 1000),
        )

    async def _step_sku_match(
        self,
        session: AsyncSession,
        receipt: Receipt,
        result: PipelineResult,
        skus: list,
    ) -> None:
        if result.ofd_receipt is None:
            return

        t0 = time.monotonic()
        matched_items = []
        unmatched_names = []

        for item in result.ofd_receipt.items:
            match_result = self._sku_matcher.match(item.name, skus)
            matched_items.append(
                {
                    "raw_name": item.name,
                    "qty": item.quantity,
                    "price": item.price,
                    "matched_sku_id": match_result.sku_id if match_result else None,
                    "confidence": match_result.confidence if match_result else None,
                }
            )
            if match_result is None:
                unmatched_names.append(item.name)

        result.matched_items = matched_items
        matched_count = len(matched_items) - len(unmatched_names)

        logger.info(
            "pipeline.sku_match, receipt_id=%d, matched=%d, total=%d, unmatched=%s, duration_ms=%d",
            receipt.id,
            matched_count,
            len(matched_items),
            unmatched_names,
            int((time.monotonic() - t0) * 1000),
        )

        if matched_count == 0 and matched_items:
            signal = self._fraud_checker.no_sku_match_signal()
            result.fraud_signals.append(signal)
            raise StepError(
                step="sku_match",
                reason="No SKUs matched from OFD items",
                new_status=ReceiptStatus.on_review.value,
            )

    async def _step_bonus_calc(
        self,
        receipt: Receipt,
        result: PipelineResult,
        skus: list,
        promotions: list,
        seller_receipt_count: int,
    ) -> None:
        if result.ofd_receipt is None:
            return

        t0 = time.monotonic()
        purchase_date = (
            result.ofd_receipt.purchase_date.date() if result.ofd_receipt.purchase_date else datetime.now(tz=UTC).date()
        )
        items_ctx = [
            ReceiptItemContext(
                raw_name=item["raw_name"],
                qty=item["qty"],
                price=item["price"],
                matched_sku_id=item["matched_sku_id"],
                confidence=item["confidence"],
            )
            for item in result.matched_items
        ]
        ctx = RuleContext(
            receipt_items=items_ctx,
            total_sum=result.ofd_receipt.total_sum,
            sku_catalog=skus,
            seller_id=receipt.seller_id,
            purchase_date=purchase_date,
            seller_receipt_count=seller_receipt_count,
        )
        bonus_result = calculate_bonus(active_promotions=promotions, context=ctx)
        result.bonus_amount = bonus_result.total_amount
        result.bonus_breakdown = bonus_result.breakdown

        logger.info(
            "pipeline.bonus_calc, receipt_id=%d, total=%d, promos=%d, duration_ms=%d",
            receipt.id,
            result.bonus_amount,
            len(result.bonus_breakdown),
            int((time.monotonic() - t0) * 1000),
        )

    async def _step_finalize_review(self, session: AsyncSession, receipt: Receipt, result: PipelineResult) -> None:
        """Persist enrichment + a SUGGESTED bonus, then route the receipt to on_review.

        Per spec (S8 / A2 / UC-03) the system never auto-approves and never
        auto-creates a bonus_transaction. The pipeline runs all checks, stores the
        parsed QR / OFD data, matched items and a *suggested* bonus, then hands the
        receipt to the admin queue (on_review). The admin makes the final
        approve/reject decision and confirms the bonus amount — the
        bonus_transaction is inserted by the admin approve endpoint, not here.
        """
        t0 = time.monotonic()
        pqr = result.parsed_qr
        ofd = result.ofd_receipt

        async with session.begin():
            # SELECT … FOR UPDATE to prevent concurrent state changes.
            locked = await session.execute(select(Receipt).where(Receipt.id == receipt.id).with_for_update())
            locked_receipt = locked.scalar_one_or_none()
            if locked_receipt is None:
                raise StepError(
                    step="finalize_review",
                    reason=f"Receipt {receipt.id} disappeared during processing",
                    new_status=ReceiptStatus.on_review.value,
                )

            # Build update values — terminal pipeline status is on_review (admin decides).
            update_vals: dict = {
                "status": ReceiptStatus.on_review.value,
                "fraud_signals": [s.to_dict() for s in result.fraud_signals],
                "items": result.matched_items,
                # Suggested bonus only — the admin confirms/edits it on approve.
                "bonus_amount": result.bonus_amount,
            }
            if pqr:
                update_vals.update(
                    {
                        "qr_raw": result.qr_raw,
                        "fn": pqr.fn,
                        "fd": pqr.fd,
                        "fp": pqr.fp,
                        "purchase_date": pqr.purchase_date.date(),
                    }
                )
            if ofd:
                update_vals.update(
                    {
                        "total_sum": ofd.total_sum,
                        "shop_name": ofd.shop_name,
                        "shop_inn": ofd.shop_inn,
                    }
                )

            await session.execute(update(Receipt).where(Receipt.id == receipt.id).values(**update_vals))

        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "pipeline.review_ready, receipt_id=%d, suggested_bonus=%d, duration_ms=%d",
            receipt.id,
            result.bonus_amount,
            duration_ms,
        )

    # -------------------------------------------------------------------------
    # Error handling
    # -------------------------------------------------------------------------

    async def _handle_step_error(
        self,
        session: AsyncSession,
        receipt: Receipt,
        result: PipelineResult,
        exc: StepError,
    ) -> None:
        logger.info(
            "pipeline.step_error",
            extra={
                "receipt_id": receipt.id,
                "step": exc.step,
                "new_status": exc.new_status,
                "reason": exc.reason,
            },
        )
        # Store the machine-readable reason so the admin (on_review = manual
        # fallback) and alerting can see why the pipeline could not finish
        # automatically. Applies to on_review and rejected alike.
        rejection_reason: str | None = exc.reason or None
        await self._set_status_with_signals(
            session,
            receipt,
            exc.new_status,
            result.fraud_signals,
            rejection_reason=rejection_reason,
        )

    async def _set_status_with_signals(
        self,
        session: AsyncSession,
        receipt: Receipt,
        new_status: str,
        fraud_signals: list,
        rejection_reason: str | None = None,
    ) -> None:
        vals: dict = {
            "status": new_status,
            "fraud_signals": [s.to_dict() if isinstance(s, FraudSignal) else s for s in fraud_signals],
        }
        if rejection_reason:
            vals["rejection_reason"] = rejection_reason
        try:
            await session.execute(update(Receipt).where(Receipt.id == receipt.id).values(**vals))
            await session.commit()
        except Exception as upd_exc:
            logger.exception("pipeline.status_update_failed, receipt_id=%d: %s", receipt.id, upd_exc)

    # -------------------------------------------------------------------------
    # DB helpers
    # -------------------------------------------------------------------------

    @staticmethod
    async def _load_receipt(session: AsyncSession, receipt_id: int) -> Receipt | None:
        result = await session.execute(select(Receipt).where(Receipt.id == receipt_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def _load_skus(session: AsyncSession, brand_id: int) -> list:
        result = await session.execute(select(Sku).where(Sku.brand_id == brand_id, Sku.is_active.is_(True)))
        return list(result.scalars().all())

    @staticmethod
    async def _load_active_promotions(session: AsyncSession, receipt: Receipt) -> list:
        now = datetime.now(tz=UTC)
        result = await session.execute(
            select(Promotion).where(
                Promotion.brand_id == receipt.brand_id,
                Promotion.status == PromotionStatus.active.value,
                Promotion.starts_at <= now,
                Promotion.ends_at >= now,
            )
        )
        return list(result.scalars().all())

    @staticmethod
    async def _count_seller_receipts(session: AsyncSession, receipt: Receipt) -> int:
        result = await session.execute(
            select(func.count(Receipt.id)).where(
                Receipt.seller_id == receipt.seller_id,
                Receipt.brand_id == receipt.brand_id,
                Receipt.status == ReceiptStatus.approved.value,
                Receipt.is_deleted.is_(False),
            )
        )
        return result.scalar_one() or 0

    async def _try_load_file_via_storage(self, file_url: str) -> bytes | None:
        """Load file bytes via the injected storage backend.

        Supports ``local://``, ``file://`` (legacy), and silently returns
        ``None`` for placeholder/unsupported URIs (e.g. ``tg://``).
        """
        if not file_url or file_url.startswith("tg://"):
            return None
        try:
            return await self._storage.read(file_url)
        except FileNotFoundError:
            logger.warning("pipeline.file_not_found, url=%s", file_url)
            return None
        except Exception as exc:
            logger.warning("pipeline.file_load_failed, url=%s: %s", file_url, exc)
            return None
