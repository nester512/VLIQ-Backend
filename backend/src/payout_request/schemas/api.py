"""Payout request Pydantic schemas.

H13: PayoutRequestCreate is now a slim seller-facing schema — no status/brand_id exposure.
     The service layer sets status=new and derives brand_id from the seller record.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from src.payout_request.models import PayoutRequestStatus
from src.seller.models import PayoutKind


class PayoutRequestCreate(BaseModel):
    """What the seller submits to create a payout request.

    The service layer will:
    - Verify available balance >= amount (SELECT FOR UPDATE).
    - Set status=new automatically.
    - Insert payout_hold bonus_transaction atomically.
    """

    amount: int = Field(..., gt=0, description="Amount in kopecks; at least PAYOUT_MIN_AMOUNT")
    payout_kind: PayoutKind = Field(..., description="Only sbp_phone is accepted (BRD S5)")
    phone: str | None = Field(default=None, max_length=32, description="Phone for SBP, entered in this form (В-5-A)")
    # Older clients send the phone here; kept so a cached app keeps working.
    payout_masked: str | None = Field(default=None, max_length=64, deprecated=True)


class PayoutRequestApprove(BaseModel):
    """Admin approval payload."""

    external_txn_id: str | None = Field(
        default=None,
        max_length=128,
        description="External transaction ID from payment processor",
    )


class PayoutRequestReject(BaseModel):
    """Admin rejection payload."""

    admin_comment: str | None = Field(
        default=None, max_length=1000, description="Reason for rejection shown to the seller (required)"
    )


class PayoutRequestUpdate(BaseModel):
    """Admin edit of a pending payout — amount / comment / txn id (KAN-22).

    Status is intentionally NOT editable here — state transitions must go
    through the /approve and /reject action endpoints.
    """

    amount: int | None = Field(default=None, gt=0, description="New payout amount in kopecks")
    admin_comment: str | None = None
    external_txn_id: str | None = Field(default=None, max_length=128)


class PayoutRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seller_id: int
    seller_name: str | None = None
    seller_store: str | None = None
    brand_id: int
    amount: int
    payout_kind: PayoutKind
    payout_masked: str
    status: PayoutRequestStatus
    admin_comment: str | None = None
    external_txn_id: str | None = None
    created_at: datetime
    updated_at: datetime | None = None
    taken_at: datetime | None = None
    paid_at: datetime | None = None
    rejected_at: datetime | None = None
    created_by: int | None = None
    updated_by: int | None = None


class PayoutCoverageRead(BaseModel):
    """One receipt covered by a payout (BRD В-8-A)."""

    receipt_id: int
    amount: int = Field(description="Part of the payout attributed to this receipt, kopecks")
    bonus_amount: int
    receipt_status: str
    purchase_date: date | None = None
    total_sum: int | None = None


class PayoutStatusTotal(BaseModel):
    count: int = 0
    amount: int = 0


class PayoutSummaryRead(BaseModel):
    """Totals over ALL payout requests matching the filters (not just one page)."""

    new: PayoutStatusTotal = Field(default_factory=PayoutStatusTotal)
    in_progress: PayoutStatusTotal = Field(default_factory=PayoutStatusTotal)
    paid: PayoutStatusTotal = Field(default_factory=PayoutStatusTotal)
    rejected: PayoutStatusTotal = Field(default_factory=PayoutStatusTotal)
    paid_this_month: PayoutStatusTotal = Field(
        default_factory=PayoutStatusTotal, description="Paid since the 1st of the current month (by paid_at)"
    )
