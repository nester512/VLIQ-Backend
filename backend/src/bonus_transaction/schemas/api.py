from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.bonus_transaction.models import BonusTransactionKind


class BonusTransactionCreate(BaseModel):
    seller_id: int = Field(..., description="Seller telegram_id")
    brand_id: int
    amount: int = Field(..., description="Signed amount (positive=accrual, negative=spend)")
    kind: BonusTransactionKind
    source_type: str = Field(..., max_length=32, description="receipt | payout | admin")
    source_id: int | None = Field(default=None, description="ID of the source row (polymorphic, no FK)")
    promotion_id: int | None = None
    reason: str | None = None


class BonusTransactionUpdate(BaseModel):
    # Ledger rows are append-only; included for API symmetry only.
    reason: str | None = None


class BonusTransactionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seller_id: int
    brand_id: int
    amount: int
    kind: BonusTransactionKind
    source_type: str
    source_id: int | None = None
    promotion_id: int | None = None
    reason: str | None = None
    created_by: int | None = None
    created_at: datetime
