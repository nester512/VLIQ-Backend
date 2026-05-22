from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from src.payout_request.models import PayoutRequestStatus
from src.seller.models import PayoutKind


class PayoutRequestCreate(BaseModel):
    seller_id: int
    brand_id: int
    amount: int
    payout_kind: PayoutKind
    payout_masked: str = Field(..., max_length=64, description="Snapshot of destination at request time")
    status: PayoutRequestStatus = PayoutRequestStatus.new
    admin_comment: Optional[str] = None
    external_txn_id: Optional[str] = Field(default=None, max_length=128)


class PayoutRequestUpdate(BaseModel):
    amount: Optional[int] = None
    payout_kind: Optional[PayoutKind] = None
    payout_masked: Optional[str] = Field(default=None, max_length=64)
    status: Optional[PayoutRequestStatus] = None
    admin_comment: Optional[str] = None
    external_txn_id: Optional[str] = Field(default=None, max_length=128)


class PayoutRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seller_id: int
    brand_id: int
    amount: int
    payout_kind: PayoutKind
    payout_masked: str
    status: PayoutRequestStatus
    admin_comment: Optional[str] = None
    external_txn_id: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
