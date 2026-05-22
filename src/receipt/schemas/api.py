from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from src.receipt.models import ReceiptFileKind, ReceiptStatus


class ReceiptItem(BaseModel):
    raw_name: str
    qty: float
    price: int
    matched_sku_id: Optional[int] = None
    confidence: Optional[float] = None


class ReceiptFraudSignal(BaseModel):
    signal: str
    severity: str
    duplicate_of_id: Optional[int] = None
    details: Optional[dict[str, Any]] = None


class ReceiptCreate(BaseModel):
    seller_id: int = Field(..., description="Seller telegram_id")
    brand_id: int
    status: ReceiptStatus = ReceiptStatus.pending
    bonus_amount: int = 0
    rejection_reason: Optional[str] = None
    file_kind: ReceiptFileKind
    file_url: str = Field(..., max_length=1000)
    file_hash: str = Field(..., max_length=128, description="Unique content hash")
    purchase_date: Optional[date] = None
    total_sum: Optional[int] = Field(default=None, description="Total in kopeks")
    shop_name: Optional[str] = Field(default=None, max_length=255)
    shop_inn: Optional[str] = Field(default=None, max_length=32)
    qr_raw: Optional[str] = Field(default=None, max_length=1000)
    fn: Optional[str] = Field(default=None, max_length=64)
    fd: Optional[str] = Field(default=None, max_length=64)
    fp: Optional[str] = Field(default=None, max_length=64)
    ocr_confidence: Optional[float] = None
    ocr_raw: Optional[dict[str, Any]] = None
    items: list[ReceiptItem] = Field(default_factory=list)
    fraud_signals: list[ReceiptFraudSignal] = Field(default_factory=list)
    is_deleted: bool = False


class ReceiptUpdate(BaseModel):
    status: Optional[ReceiptStatus] = None
    bonus_amount: Optional[int] = None
    rejection_reason: Optional[str] = None
    file_kind: Optional[ReceiptFileKind] = None
    file_url: Optional[str] = Field(default=None, max_length=1000)
    file_hash: Optional[str] = Field(default=None, max_length=128)
    purchase_date: Optional[date] = None
    total_sum: Optional[int] = None
    shop_name: Optional[str] = Field(default=None, max_length=255)
    shop_inn: Optional[str] = Field(default=None, max_length=32)
    qr_raw: Optional[str] = Field(default=None, max_length=1000)
    fn: Optional[str] = Field(default=None, max_length=64)
    fd: Optional[str] = Field(default=None, max_length=64)
    fp: Optional[str] = Field(default=None, max_length=64)
    ocr_confidence: Optional[float] = None
    ocr_raw: Optional[dict[str, Any]] = None
    items: Optional[list[ReceiptItem]] = None
    fraud_signals: Optional[list[ReceiptFraudSignal]] = None
    is_deleted: Optional[bool] = None


class ReceiptRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seller_id: int
    brand_id: int
    status: ReceiptStatus
    bonus_amount: int
    rejection_reason: Optional[str] = None
    file_kind: ReceiptFileKind
    file_url: str
    file_hash: str
    purchase_date: Optional[date] = None
    total_sum: Optional[int] = None
    shop_name: Optional[str] = None
    shop_inn: Optional[str] = None
    qr_raw: Optional[str] = None
    fn: Optional[str] = None
    fd: Optional[str] = None
    fp: Optional[str] = None
    ocr_confidence: Optional[float] = None
    ocr_raw: Optional[dict[str, Any]] = None
    items: list[ReceiptItem]
    fraud_signals: list[ReceiptFraudSignal]
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
