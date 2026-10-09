"""Seller Pydantic schemas.

H5:  SellerRead omits payout_encrypted — use SellerReadSensitive (admin only) for decrypted data.
H27: phone_e164 validated with E.164 pattern.
H28: outlet_inn validated as 10 or 12 digits (INN).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from src.seller.models import PayoutKind, SellerStatus

_PHONE_PATTERN = r"^\+[1-9]\d{7,14}$"
_INN_PATTERN = r"^\d{10}(\d{2})?$"


class SellerTgUpsertRequest(BaseModel):
    """Регистрация / обновление seller по telegram_id (без авторизации)."""

    id: int = Field(..., ge=1, description="Telegram ID (PK)")
    brand_id: int = Field(..., description="К какому бренду относится seller")
    phone_e164: str = Field(..., max_length=32, pattern=_PHONE_PATTERN, description="Телефон в формате E.164")
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)


class SellerCreate(BaseModel):
    telegram_id: int = Field(..., description="Telegram user ID (used as PK)")
    brand_id: int
    phone_e164: str = Field(..., max_length=32, pattern=_PHONE_PATTERN, description="Phone in E.164 format")
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    region: str | None = Field(default=None, max_length=255)
    outlet_name: str | None = Field(default=None, max_length=255)
    outlet_address: str | None = Field(default=None, max_length=255)
    outlet_count: int | None = Field(default=None, ge=1, le=1000)
    outlet_chain: str | None = Field(default=None, max_length=255)
    outlet_inn: str | None = Field(default=None, max_length=32, pattern=_INN_PATTERN)
    position: str | None = Field(default=None, max_length=255)
    status: SellerStatus = SellerStatus.pending
    block_reason: str | None = None
    payout_kind: PayoutKind | None = None
    payout_masked: str | None = Field(default=None, max_length=64)
    # payout_encrypted is write-only; not returned in any Read schema (H5).
    payout_account_raw: str | None = Field(
        default=None,
        description="Plain-text payout account — will be encrypted before storage (H4)",
    )


class SellerUpdate(BaseModel):
    brand_id: int | None = None
    phone_e164: str | None = Field(default=None, max_length=32, pattern=_PHONE_PATTERN)
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=255)
    region: str | None = Field(default=None, max_length=255)
    outlet_name: str | None = Field(default=None, max_length=255)
    outlet_address: str | None = Field(default=None, max_length=255)
    outlet_count: int | None = Field(default=None, ge=1, le=1000)
    outlet_chain: str | None = Field(default=None, max_length=255)
    outlet_inn: str | None = Field(default=None, max_length=32, pattern=_INN_PATTERN)
    position: str | None = Field(default=None, max_length=255)
    status: SellerStatus | None = None
    block_reason: str | None = None
    payout_kind: PayoutKind | None = None
    payout_masked: str | None = Field(default=None, max_length=64)
    # See SellerCreate note on payout_account_raw.
    payout_account_raw: str | None = Field(
        default=None,
        description="Plain-text payout account — encrypted before storage (H4)",
    )


class SellerRead(BaseModel):
    """Public seller schema — payout_encrypted is intentionally omitted (H5)."""

    model_config = ConfigDict(from_attributes=True)

    telegram_id: int
    brand_id: int
    phone_e164: str
    first_name: str | None = None
    last_name: str | None = None
    city: str | None = None
    region: str | None = None
    outlet_name: str | None = None
    outlet_address: str | None = None
    outlet_count: int | None = None
    outlet_chain: str | None = None
    outlet_inn: str | None = None
    position: str | None = None
    status: SellerStatus
    block_reason: str | None = None
    payout_kind: PayoutKind | None = None
    payout_masked: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None


class SellerReadSensitive(SellerRead):
    """Extended seller schema for admin use — includes decrypted payout details (H5).

    The payout_account_decrypted field is populated by the handler layer
    after calling PayoutCrypto.decrypt(seller.payout_encrypted).
    """

    payout_account_decrypted: str | None = Field(
        default=None,
        description="Decrypted payout account number / phone — admin-only (H4)",
    )


class SellerStats(BaseModel):
    """Receipt activity and risk factor of one seller (admin)."""

    receipts_total: int = 0
    receipts_approved: int = Field(default=0, description="approved + paid_out")
    receipts_rejected: int = 0
    receipts_on_review: int = 0
    receipts_30d: int = Field(default=0, description="Uploads in the last 30 days — activity frequency")
    receipts_duplicates: int = Field(default=0, description="Receipts carrying any duplicate fraud signal")
    first_receipt_at: datetime | None = None
    last_receipt_at: datetime | None = None
    risk_score: int = Field(default=0, ge=0, le=100, description="Moderation heuristic, see stats_service")
    risk_level: Literal["low", "medium", "high"] = "low"
    risk_flags: list[str] = Field(default_factory=list, description="low_data | high_reject_rate | duplicates")


class SellerWeekActivity(BaseModel):
    week_start: date
    receipts: int
    approved: int


class SellerListItem(SellerRead):
    """Row of the admin seller list: profile + activity stats + risk (one SQL query)."""

    stats: SellerStats


class SellerReadAdmin(SellerRead):
    """Admin-only seller detail schema — adds computed balance and receipt count.

    These fields are populated by the GET /sellers/{telegram_id} handler via
    separate aggregate queries.  The list endpoint (GET /sellers) continues to
    use SellerRead to keep the query light.
    """

    balance_available: int = Field(
        ...,
        description="Spendable bonus balance (same calculation as GET /sellers/me/balance)",
    )
    receipts_total: int = Field(
        ...,
        description="Total number of non-deleted receipts submitted by this seller",
    )
    stats: SellerStats = Field(default_factory=SellerStats)
    total_accrued: int = 0
    total_paid_out: int = 0
    on_hold: int = 0
    avg_bonus: int = Field(default=0, description="Mean bonus of approved receipts, kopecks")
    weekly_activity: list[SellerWeekActivity] = Field(default_factory=list)


class SellerLoginTransferRequest(BaseModel):
    """Super admin: link the seller's NEW Telegram account after the identity check."""

    new_telegram_id: int = Field(gt=0, description="Telegram ID of the seller's new account")
    reason: str = Field(
        min_length=10, max_length=2000,
        description="Основание: обращение, как и кем проверена личность (идёт в аудит)",
    )


class SellerLoginTransferRead(BaseModel):
    seller_id: int
    telegram_id: int
    already_linked: bool


class SellerBlockRequest(BaseModel):
    """Body for POST /sellers/{telegram_id}/block (T2)."""

    reason: str | None = Field(default=None, description="Optional block reason")


class SellerBalanceRead(BaseModel):
    """Balance aggregate for GET /sellers/me/balance (H23)."""

    available: int = Field(..., description="Bonuses available for payout")
    on_hold: int = Field(..., description="Bonuses locked in pending payout requests")
    total_accrued: int = Field(..., description="All-time accrued bonuses")
    total_paid_out: int = Field(..., description="All-time completed payouts (abs value)")
    on_review: int = Field(default=0, description="Sum of bonuses on receipts not decided yet (S4)")
