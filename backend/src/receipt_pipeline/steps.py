"""Pipeline step data containers."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.ofd_client.schemas import OFDReceipt
from src.receipt_ocr.qr_parser import ParsedQR


@dataclass
class PipelineInput:
    """Initial data available at the start of the pipeline."""

    receipt_id: int


@dataclass
class StepError(Exception):
    """Raised by a pipeline step to signal a recoverable error.

    The orchestrator catches this and sets the appropriate receipt status.
    """

    step: str
    reason: str
    new_status: str  # ReceiptStatus value
    fraud_signal: object | None = None  # FraudSignal | None


@dataclass
class PipelineResult:
    """Accumulated result across all pipeline steps."""

    qr_raw: str | None = None
    parsed_qr: ParsedQR | None = None
    ofd_receipt: OFDReceipt | None = None
    fraud_signals: list = field(default_factory=list)  # list[FraudSignal]
    matched_items: list = field(default_factory=list)  # list[dict]
    bonus_amount: int = 0
    bonus_breakdown: list = field(default_factory=list)  # list[AppliedPromotion]
    # Per-attachment extraction evidence (position → {qr_candidates, pdf_pages, warnings}),
    # plus the distinct confident fiscal identities found across the whole package.
    # Kept for admin diagnostics and attachment/page provenance.
    extraction_evidence: dict = field(default_factory=dict)
    detected_identities: list = field(default_factory=list)  # list[dict{fn,fd,fp}]
