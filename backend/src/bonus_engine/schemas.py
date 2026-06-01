"""Bonus engine data schemas — inputs and outputs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date


@dataclass
class ReceiptItemContext:
    """Single receipt line item as used by the bonus engine."""

    raw_name: str
    qty: float
    price: int  # kopecks
    matched_sku_id: int | None = None
    confidence: float | None = None


@dataclass
class RuleContext:
    """All data the engine needs to evaluate promotion rules.

    Attributes:
        receipt_items: Line items from the OFD receipt (after SKU matching).
        total_sum: Total receipt sum in kopecks.
        sku_catalog: SKU objects (ORM) available for this brand.
        seller_id: Seller's telegram_id.
        purchase_date: Date of purchase (from QR / OFD).
        seller_receipt_count: Number of previously approved receipts for this seller
            under this brand — used for ``first_n_receipts`` rule.
    """

    receipt_items: list[ReceiptItemContext]
    total_sum: int
    sku_catalog: list  # list of Sku ORM objects
    seller_id: int
    purchase_date: date
    seller_receipt_count: int = 0


@dataclass
class AppliedPromotion:
    """Contribution of a single promotion to the total bonus."""

    promotion_id: int
    rule_index: int  # index of the rule within promotion.rules list
    amount: int  # bonus amount in bonus-units
    reason: str  # human-readable explanation


@dataclass
class BonusResult:
    """Aggregated result returned by :func:`~src.bonus_engine.engine.calculate_bonus`."""

    total_amount: int  # sum of all AppliedPromotion.amount
    breakdown: list[AppliedPromotion] = field(default_factory=list)
