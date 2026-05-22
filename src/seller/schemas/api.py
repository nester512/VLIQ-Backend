from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from src.seller.models import PayoutKind, SellerStatus


class SellerTgUpsertRequest(BaseModel):
    """Регистрация / обновление seller по telegram_id (без авторизации)."""

    id: int = Field(..., ge=1, description="Telegram ID (PK)")
    brand_id: int = Field(..., description="К какому бренду относится seller")
    phone_e164: str = Field(..., max_length=32, description="Телефон в формате E.164")
    first_name: Optional[str] = Field(default=None, max_length=255)
    last_name: Optional[str] = Field(default=None, max_length=255)


class SellerCreate(BaseModel):
    telegram_id: int = Field(..., description="Telegram user ID (used as PK)")
    brand_id: int
    phone_e164: str = Field(..., max_length=32, description="Phone in E.164 format, e.g. +79991234567")
    first_name: Optional[str] = Field(default=None, max_length=255)
    last_name: Optional[str] = Field(default=None, max_length=255)
    city: Optional[str] = Field(default=None, max_length=255)
    region: Optional[str] = Field(default=None, max_length=255)
    outlet_name: Optional[str] = Field(default=None, max_length=255)
    outlet_address: Optional[str] = Field(default=None, max_length=255)
    outlet_chain: Optional[str] = Field(default=None, max_length=255)
    outlet_inn: Optional[str] = Field(default=None, max_length=32)
    position: Optional[str] = Field(default=None, max_length=255)
    status: SellerStatus = SellerStatus.pending
    block_reason: Optional[str] = None
    payout_kind: Optional[PayoutKind] = None
    payout_masked: Optional[str] = Field(default=None, max_length=64)
    payout_encrypted: Optional[str] = None
    consent_pdn_at: Optional[datetime] = None


class SellerUpdate(BaseModel):
    brand_id: Optional[int] = None
    phone_e164: Optional[str] = Field(default=None, max_length=32)
    first_name: Optional[str] = Field(default=None, max_length=255)
    last_name: Optional[str] = Field(default=None, max_length=255)
    city: Optional[str] = Field(default=None, max_length=255)
    region: Optional[str] = Field(default=None, max_length=255)
    outlet_name: Optional[str] = Field(default=None, max_length=255)
    outlet_address: Optional[str] = Field(default=None, max_length=255)
    outlet_chain: Optional[str] = Field(default=None, max_length=255)
    outlet_inn: Optional[str] = Field(default=None, max_length=32)
    position: Optional[str] = Field(default=None, max_length=255)
    status: Optional[SellerStatus] = None
    block_reason: Optional[str] = None
    payout_kind: Optional[PayoutKind] = None
    payout_masked: Optional[str] = Field(default=None, max_length=64)
    payout_encrypted: Optional[str] = None
    consent_pdn_at: Optional[datetime] = None


class SellerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    telegram_id: int
    brand_id: int
    phone_e164: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    city: Optional[str] = None
    region: Optional[str] = None
    outlet_name: Optional[str] = None
    outlet_address: Optional[str] = None
    outlet_chain: Optional[str] = None
    outlet_inn: Optional[str] = None
    position: Optional[str] = None
    status: SellerStatus
    block_reason: Optional[str] = None
    payout_kind: Optional[PayoutKind] = None
    payout_masked: Optional[str] = None
    payout_encrypted: Optional[str] = None
    consent_pdn_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
