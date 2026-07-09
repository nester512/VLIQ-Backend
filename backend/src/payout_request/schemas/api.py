"""Payout request Pydantic schemas.

H13: PayoutRequestCreate is now a slim seller-facing schema — no status/brand_id exposure.
     The service layer sets status=new and derives brand_id from the seller record.
"""

from __future__ import annotations

from datetime import datetime

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

    amount: int = Field(..., gt=0, description="Amount in bonus units to withdraw")
    payout_kind: PayoutKind = Field(..., description="Payout method (card | sbp_phone | sbp_bank)")
    # payout_masked is derived from the seller's profile at request time.
    # Sellers can optionally override (e.g. one-time different account).
    payout_masked: str | None = Field(
        default=None,
        max_length=64,
        description="Masked destination (last 4 digits, etc.) — defaults to seller profile value",
    )


class PayoutRequestApprove(BaseModel):
    """Admin approval payload."""

    external_txn_id: str | None = Field(
        default=None,
        max_length=128,
        description="External transaction ID from payment processor",
    )


class PayoutRequestReject(BaseModel):
    """Admin rejection payload."""

    admin_comment: str | None = Field(default=None, description="Reason for rejection shown to seller")


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
    created_by: int | None = None
    updated_by: int | None = None
