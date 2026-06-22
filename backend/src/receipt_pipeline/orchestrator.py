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
from src.notification import outbox as notification_outbox
from src.ofd_client.base import OFDClientProtocol
from src.ofd_client.cache import OFDCache
from src.ofd_client.exceptions import OFDBlockedError, OFDNotFoundError, OFDRateLimitError
from src.promotion.models import Promotion, PromotionStatus
from src.receipt.models import AttachmentKind, Receipt, ReceiptAttachment, ReceiptStatus
from src.receipt_ocr.pdf import render_pdf_pages
from src.receipt_ocr.qr_extractor import QRExtractor
from src.receipt_ocr.qr_parser import QRParseError, parse_qr_string
from src.receipt_ocr.storage import LocalFileStorage, ReceiptStorage
from src.receipt_pipeline.identity_aggregator import AggregationResult, aggregate_identities
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

# Terminal statuses — a receipt here is never reprocessed (retry/idempotency guard).
_TERMINAL_STATUSES = frozenset(
    {ReceiptStatus.approved.value, ReceiptStatus.rejected.value, ReceiptStatus.paid_out.value}
)

# System rejection: >1 distinct confident fiscal identity in one submission.
MULTIPLE_RECEIPTS_CODE = "MULTIPLE_RECEIPTS_DETECTED"
MULTIPLE_RECEIPTS_USER_REASON = (
    "В одной загрузке обнаружено несколько разных чеков. Загрузите каждый чек отдельно."
)

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
        """Run the package pipeline for *receipt_id*.

        Called from an arq worker. All exceptions are caught internally — a
        non-terminal receipt always ends at ``on_review`` (manual fallback) or, on
        a confident multi-receipt detection, at ``rejected`` (MULTIPLE_RECEIPTS_DETECTED).

        Retry-safe: a receipt already in a terminal status is skipped, so a retried
        job never re-notifies, re-rejects, or re-creates anything.

        Args:
            receipt_id: PK of the Receipt to process.
            session: Async SQLAlchemy session (worker provides its own).
        """
        t_start = time.monotonic()
        result = PipelineResult()

        receipt = await self._load_receipt(session, receipt_id)
        if receipt is None:
            logger.error("pipeline.receipt_not_found", extra={"receipt_id": receipt_id})
            return

        # Retry / idempotency guard: never reprocess a terminal receipt.
        if receipt.status in _TERMINAL_STATUSES:
            logger.info("pipeline.skip_terminal", extra={"receipt_id": receipt_id, "status": receipt.status})
            return

        logger.info(
            "pipeline.start",
            extra={
                "receipt_id": receipt_id,
                "brand_id": receipt.brand_id,
                "attachments": len(receipt.attachments),
                "has_scanned_qr": bool(receipt.qr_raw),
                "ocr_mode": self._ocr_mode,
            },
        )

        try:
            # Step 1: ocr_in_progress (idempotent — no-op if already there).
            await self._step_set_status(session, receipt, "ocr_in_progress")

            # Step 2: collect ALL fiscal-identity candidates across scanned QR +
            # every image + every PDF page. Runs in BOTH demo and full mode — the
            # multiple-receipts check is QR-based, not OFD-based.
            agg = await self._collect_candidates(receipt, result)

            # Step 3: >1 distinct confident identity → terminal system rejection.
            if agg.decision == "multiple":
                await self._system_reject_multiple(session, receipt, result)
                self._log_complete(receipt_id, ReceiptStatus.rejected.value, t_start)
                return

            # 0 or 1 identity. Demo mode → manual review (no OFD/bonus).
            if self._ocr_mode == "demo":
                await self._finalize_demo(session, receipt, result)
                self._log_complete(receipt_id, ReceiptStatus.on_review.value, t_start)
                return

            # Full mode: drive OFD/SKU/bonus from the single identity (no-ops if 0).
            await self._step_fraud_early(session, receipt, result)
            await self._step_ofd_fetch(session, receipt, result)
            await self._step_verify_qr_vs_ofd(session, receipt, result)
            skus = await self._load_skus(session, receipt.brand_id)
            await self._step_sku_match(session, receipt, result, skus)
            promotions = await self._load_active_promotions(session, receipt)
            seller_count = await self._count_seller_receipts(session, receipt)
            await self._step_bonus_calc(receipt, result, skus, promotions, seller_count)
            await self._step_finalize_review(session, receipt, result)

            receipt_pipeline_duration_seconds.labels(status=ReceiptStatus.on_review.value).observe(
                time.monotonic() - t_start
            )
            self._log_complete(receipt_id, ReceiptStatus.on_review.value, t_start)

        except StepError as exc:
            await self._handle_step_error(session, receipt, result, exc)
            receipt_pipeline_duration_seconds.labels(status=exc.new_status).observe(time.monotonic() - t_start)
            self._log_complete(receipt_id, exc.new_status, t_start)

        except Exception as exc:
            logger.exception("pipeline.unexpected_error", extra={"receipt_id": receipt_id, "error": str(exc)})
            await self._set_status_with_signals(
                session,
                receipt,
                ReceiptStatus.on_review.value,
                result.fraud_signals,
                extra_vals=self._recognized_vals(result),
            )
            receipt_pipeline_duration_seconds.labels(status="error").observe(time.monotonic() - t_start)
            self._log_complete(receipt_id, ReceiptStatus.on_review.value, t_start)

    @staticmethod
    def _log_complete(receipt_id: int, final_status: str, t_start: float) -> None:
        logger.info(
            "pipeline.complete",
            extra={
                "receipt_id": receipt_id,
                "final_status": final_status,
                "total_duration_ms": int((time.monotonic() - t_start) * 1000),
            },
        )

    # -------------------------------------------------------------------------
    # Candidate collection + aggregation (package-aware)
    # -------------------------------------------------------------------------

    async def _collect_candidates(self, receipt: Receipt, result: PipelineResult) -> AggregationResult:  # noqa: PLR0912
        """Decode every fiscal-QR candidate in the submission and aggregate identities.

        Sources: the optional scanned QR + every image attachment (all QR codes) +
        every PDF page (all QR codes). Each attachment's per-file evidence
        (candidate count, PDF page count, warnings) is recorded for the admin.
        Fills ``result.parsed_qr`` / ``result.qr_raw`` from the single confident
        identity so the downstream OFD flow runs unchanged.
        """
        raw_by_source: list[tuple[str, str]] = []
        evidence: dict[int, dict] = {}

        if receipt.qr_raw:
            raw_by_source.append(("scanned_qr", receipt.qr_raw))

        for att in sorted(receipt.attachments, key=lambda a: a.position):
            ev: dict = {"kind": att.kind, "qr_candidates": 0, "warnings": []}
            data = await self._try_load_file_via_storage(att.storage_uri)
            if data is None:
                ev["warnings"].append("file_unreadable")
                evidence[att.position] = ev
                continue
            is_pdf = att.kind == AttachmentKind.pdf.value or (att.mime_type or "").lower() == "application/pdf"
            if is_pdf:
                pages = await asyncio.to_thread(render_pdf_pages, data)
                ev["pdf_pages"] = len(pages)
                if not pages:
                    ev["warnings"].append("pdf_not_rasterized")
                for pidx, page_png in enumerate(pages):
                    texts = await self._qr_extractor.extract_all(page_png)
                    ev["qr_candidates"] += len(texts)
                    for text in texts:
                        raw_by_source.append((f"attachment[{att.position}]:page{pidx}", text))
            else:
                texts = await self._qr_extractor.extract_all(data)
                ev["qr_candidates"] += len(texts)
                for text in texts:
                    raw_by_source.append((f"attachment[{att.position}]", text))
            evidence[att.position] = ev

        # Legacy single-file receipts (pre-0005, no attachments) still process.
        if not receipt.attachments and not receipt.qr_raw and receipt.file_url:
            data = await self._try_load_file_via_storage(receipt.file_url)
            if data is not None:
                for text in await self._qr_extractor.extract_all(data):
                    raw_by_source.append(("legacy_file", text))

        agg = aggregate_identities(raw_by_source)
        result.extraction_evidence = evidence
        result.detected_identities = [{"fn": i.fn, "fd": i.fd, "fp": i.fp} for i in agg.unique_identities]

        if agg.primary is not None:
            raw = agg.raw_for(agg.primary)
            if raw is not None:
                result.qr_raw = raw
                try:
                    result.parsed_qr = parse_qr_string(raw)
                except QRParseError:
                    result.parsed_qr = None

        logger.info(
            "pipeline.candidates",
            extra={
                "receipt_id": receipt.id,
                "decision": agg.decision,
                "unique_identities": len(agg.unique_identities),
                "raw_candidates": len(raw_by_source),
            },
        )
        return agg

    # -------------------------------------------------------------------------
    # Terminal outcomes: demo on_review / system rejection
    # -------------------------------------------------------------------------

    async def _finalize_demo(self, session: AsyncSession, receipt: Receipt, result: PipelineResult) -> None:
        """Demo mode (OCR_MODE=demo): no OFD. Route to on_review with extraction
        evidence, a demo marker, and any historical-duplicate signals. Per spec S8
        there is NO auto bonus — the admin assigns it on approve.
        """
        signals: list = list(result.fraud_signals)
        signals.append({"signal": "demo_mode", "severity": "low", "details": "OCR skipped — manual review only"})
        signals.extend(await self._historical_duplicate_signals(session, receipt, result))

        vals = {
            **self._recognized_vals(result),
            "status": ReceiptStatus.on_review.value,
            "bonus_amount": 0,
            "rejection_reason": None,
            "fraud_signals": [s.to_dict() if isinstance(s, FraudSignal) else s for s in signals],
            "ocr_raw": self._evidence_payload(result),
        }
        # NB: use the session's auto-begun transaction + explicit commit rather than
        # `session.begin()` — earlier steps (e.g. _step_set_status) already issued an
        # execute(), so the session has an open transaction and begin() would raise
        # "A transaction is already begun".
        await session.execute(update(Receipt).where(Receipt.id == receipt.id).values(vals))
        await self._persist_attachment_evidence(session, receipt, result)
        await session.commit()
        receipt.status = ReceiptStatus.on_review.value
        logger.info("pipeline.demo_on_review, receipt_id=%d (no auto bonus — admin assigns)", receipt.id)

    async def _system_reject_multiple(self, session: AsyncSession, receipt: Receipt, result: PipelineResult) -> None:
        """MULTIPLE_RECEIPTS_DETECTED — >1 distinct confident fiscal identity in one
        submission. Keep the Receipt + all attachments, mark it rejected with the
        machine code + detected identities as evidence, and notify the seller. Atomic;
        idempotent via the terminal-status guard (a retried job is a no-op).

        Single, centralized future-work marker — do NOT scatter copies:

        # TODO(VLIQ-multi-receipt-split):
        # Split confidently detected fiscal identities into separate Receipt records
        # while preserving attachment/page provenance.
        """
        signal = self._fraud_checker.multiple_receipts_signal(result.detected_identities)
        all_signals = [s.to_dict() if isinstance(s, FraudSignal) else s for s in (*result.fraud_signals, signal)]

        if not _SM.can_transition(
            from_status=receipt.status, to_status=ReceiptStatus.rejected.value, actor="system"
        ):
            # Defensive: ocr_in_progress → rejected is a valid system transition; if
            # we somehow aren't there, fall back to on_review rather than forcing it.
            logger.error(
                "pipeline.multiple_reject_blocked",
                extra={"receipt_id": receipt.id, "status": receipt.status},
            )
            await self._set_status_with_signals(
                session, receipt, ReceiptStatus.on_review.value, [*result.fraud_signals, signal],
                extra_vals={"ocr_raw": self._evidence_payload(result)},
            )
            return

        # Explicit commit on the session's auto-begun transaction (begin() would raise
        # "already begun" — earlier steps already issued an execute). The status
        # update, attachment evidence and the outbox notification all commit together,
        # so there is no phantom send on rollback.
        await session.execute(
            update(Receipt)
            .where(Receipt.id == receipt.id)
            .values(
                {
                    "status": ReceiptStatus.rejected.value,
                    "rejection_reason": MULTIPLE_RECEIPTS_USER_REASON,
                    "fraud_signals": all_signals,
                    "bonus_amount": 0,
                    "ocr_raw": self._evidence_payload(result),
                }
            )
        )
        await self._persist_attachment_evidence(session, receipt, result)
        await notification_outbox.enqueue(
            session,
            recipient_id=receipt.seller_id,
            channel="telegram",
            template="receipt.rejected",
            payload={"receipt_id": receipt.id, "reason": MULTIPLE_RECEIPTS_USER_REASON},
        )
        await session.commit()
        receipt.status = ReceiptStatus.rejected.value
        logger.info(
            "pipeline.multiple_receipts_rejected",
            extra={
                "receipt_id": receipt.id,
                "code": MULTIPLE_RECEIPTS_CODE,
                "identities": len(result.detected_identities),
            },
        )

    async def _historical_duplicate_signals(
        self, session: AsyncSession, receipt: Receipt, result: PipelineResult
    ) -> list[FraudSignal]:
        """Historical duplicates of *prior* receipts → signals for the admin (never a
        block, never an auto-reject). Distinct from intra-package MULTIPLE_RECEIPTS."""
        signals: list[FraudSignal] = []
        # Same fiscal identity used by a previous receipt.
        pqr = result.parsed_qr
        if pqr is not None:
            existing = await self._fraud_checker.check_fn_fd_fp(session, pqr.fn, pqr.fd, pqr.fp)
            if existing is not None and existing.id != receipt.id:
                signals.append(self._fraud_checker.historical_duplicate_signal(existing.id, kind="fn_fd_fp"))
        # Same file bytes uploaded before (legacy primary-hash match).
        for att in receipt.attachments:
            existing = await self._fraud_checker.check_file_hash(session, att.file_hash)
            if existing is not None and existing.id != receipt.id:
                signals.append(self._fraud_checker.historical_duplicate_signal(existing.id, kind="file_hash"))
                break
        return signals

    @staticmethod
    def _evidence_payload(result: PipelineResult) -> dict:
        """Diagnostic extraction evidence persisted to receipt.ocr_raw."""
        return {
            "extraction_evidence": result.extraction_evidence,
            "detected_identities": result.detected_identities,
        }

    async def _persist_attachment_evidence(
        self, session: AsyncSession, receipt: Receipt, result: PipelineResult
    ) -> None:
        """Write per-attachment extraction evidence (provenance) within the caller's txn."""
        for att in receipt.attachments:
            ev = result.extraction_evidence.get(att.position)
            if ev is not None:
                await session.execute(
                    update(ReceiptAttachment).where(ReceiptAttachment.id == att.id).values(extraction=ev)
                )

    # -------------------------------------------------------------------------
    # Step implementations
    # -------------------------------------------------------------------------

    async def _step_set_status(self, session: AsyncSession, receipt: Receipt, new_status: str) -> None:
        t0 = time.monotonic()
        # Idempotent: the admin retry endpoint already flips on_review → ocr_in_progress
        # before re-enqueuing, so the worker may be invoked with the target status
        # already set. Treat that as a no-op instead of failing the transition.
        if receipt.status == new_status:
            return
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

        # SELECT … FOR UPDATE to prevent concurrent state changes. Use the session's
        # auto-begun transaction + an explicit commit — earlier steps already issued an
        # execute(), so `session.begin()` here would raise "A transaction is already begun".
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
            # Extraction provenance (per-attachment + detected identities).
            "ocr_raw": self._evidence_payload(result),
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

        # NB: dict positionally — `.values(**update_vals)` breaks on the `fn`
        # column (collides with SQLAlchemy's @_generative `fn` param).
        await session.execute(update(Receipt).where(Receipt.id == receipt.id).values(update_vals))
        await self._persist_attachment_evidence(session, receipt, result)
        await session.commit()

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
            # Persist whatever was recognized so far (QR/OFD/items) so the admin
            # has real data to review even on the on_review fallback path.
            extra_vals=self._recognized_vals(result),
        )

    @staticmethod
    def _recognized_vals(result: PipelineResult) -> dict:
        """Fields recognized so far, persisted even when the pipeline falls back
        to on_review — otherwise the admin sees an empty card despite the QR
        having been parsed. OFD data (when present) is authoritative over the QR.
        """
        vals: dict = {}
        pqr = result.parsed_qr
        ofd = result.ofd_receipt
        if result.qr_raw:
            vals["qr_raw"] = result.qr_raw
        if pqr is not None:
            vals["fn"] = pqr.fn
            vals["fd"] = pqr.fd
            vals["fp"] = pqr.fp
            vals["purchase_date"] = pqr.purchase_date.date()
            vals["total_sum"] = pqr.total_sum_kop
        if ofd is not None:
            vals["total_sum"] = ofd.total_sum
            vals["shop_name"] = ofd.shop_name
            vals["shop_inn"] = ofd.shop_inn
        if result.matched_items:
            vals["items"] = result.matched_items
        if result.extraction_evidence or result.detected_identities:
            vals["ocr_raw"] = ReceiptPipelineOrchestrator._evidence_payload(result)
        return vals

    async def _set_status_with_signals(  # noqa: PLR0913
        self,
        session: AsyncSession,
        receipt: Receipt,
        new_status: str,
        fraud_signals: list,
        rejection_reason: str | None = None,
        extra_vals: dict | None = None,
    ) -> None:
        vals: dict = {
            **(extra_vals or {}),
            "status": new_status,
            "fraud_signals": [s.to_dict() if isinstance(s, FraudSignal) else s for s in fraud_signals],
        }
        if rejection_reason:
            vals["rejection_reason"] = rejection_reason
        try:
            # NB: pass a dict positionally — `.values(**vals)` breaks when a column
            # is named `fn` (collides with SQLAlchemy's @_generative `fn` param).
            await session.execute(update(Receipt).where(Receipt.id == receipt.id).values(vals))
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
