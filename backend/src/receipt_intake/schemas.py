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


class VerificationAttemptRead(BaseModel):
    attempt_no: int
    provider: str
    method: str
    trigger: str
    outcome: str
    http_status: int | None = None
    request: dict | None = None
    response: dict | None = None
    error: str | None = None
    duration_ms: int | None = None
    created_at: datetime


class ReceiptVerificationRead(BaseModel):
    receipt_id: int
    source: str | None = None
    status: str
    attempts_count: int
    next_attempt_at: datetime | None = None
    verified_at: datetime | None = None
    ofd_response: dict | None = None
    attempts: list[VerificationAttemptRead]
