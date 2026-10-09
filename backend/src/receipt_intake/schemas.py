"""API schemas for QR intake and the OFD verification history."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from src.receipt.schemas.api import UploadWarning

ReceiptSourceT = Literal["telegram_scan", "camera_scan", "image_decode", "pdf_decode", "manual"]


class QrReceiptCreate(BaseModel):
    """Dry fiscal data of one receipt — what the seller's device scanned, decoded or typed.

    Field names follow the ФНС QR (``i`` = ФД is sent as ``fd``). The server
    re-validates everything; ``qr_raw`` is informational (the canonical string is
    rebuilt from the fields).
    """

    brand_id: int = Field(ge=1)
    source: ReceiptSourceT
    fn: str = Field(max_length=32)
    fd: str = Field(max_length=16)
    fp: str = Field(max_length=16)
    t: str = Field(max_length=20, description="YYYYMMDDTHHMM or YYYYMMDDTHHMMSS, as in the QR")
    s: str = Field(max_length=16, description="Sum in rubles, e.g. 1450.00")
    n: int = Field(default=1, description="Operation type; only 1 (приход) is accepted")
    qr_raw: str | None = Field(default=None, max_length=1000)
    idempotency_key: str | None = Field(default=None, max_length=64)


class QrReceiptCreated(BaseModel):
    receipt_id: int
    status: str = "pending"
    warnings: list[UploadWarning] = Field(default_factory=list)


# ---- Receipt journey (docs/design/RECEIPT-JOURNEY.md) ----------------------


class CheckRead(BaseModel):
    """One call to a check provider — exactly what was asked and answered."""

    id: int
    attempt_no: int
    round_no: int | None = None
    provider: str
    provider_role: str | None = None
    adapter_version: str | None = None
    method: str
    trigger: str
    outcome: str
    http_status: int | None = None
    request: dict | None = None
    response: dict | None = None
    parsed: dict | None = None
    error: str | None = None
    duration_ms: int | None = None
    created_at: datetime


class JourneyEventRead(BaseModel):
    seq: int
    at: datetime
    kind: str
    actor_type: str
    actor_id: int | None = None
    source: str | None = None
    outcome: str | None = None
    data: dict | None = None
    check: CheckRead | None = None


class JourneySummary(BaseModel):
    """The answer to «where is this receipt now» at a glance."""

    received_at: datetime | None = None
    intake_source: str | None = None
    status: str
    verification_status: str
    verified_by: str | None = None
    verified_at: datetime | None = None
    check_rounds: int = 0
    next_check_at: datetime | None = None
    decision: str | None = None  # approved | rejected | sent_to_revision
    decided_at: datetime | None = None
    decided_by: int | None = None


class ProviderRead(BaseModel):
    code: str
    title: str
    role: str
    priority: int
    enabled: bool
    available: bool = Field(description="An adapter with credentials exists in this deployment")
    disabled_until: datetime | None = None
    consecutive_failures: int = 0


class ReceiptJourneyRead(BaseModel):
    receipt_id: int
    summary: JourneySummary
    events: list[JourneyEventRead]
    providers: list[ProviderRead]


class VerifyRequest(BaseModel):
    provider: str | None = Field(default=None, max_length=32, description="Check only at this provider (default: a full round)")


class ProviderUpdate(BaseModel):
    enabled: bool | None = None
    priority: int | None = Field(default=None, ge=1, le=1000)
