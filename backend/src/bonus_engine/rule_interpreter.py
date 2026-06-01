"""Rule interpreter — evaluate a single promotion rule against a RuleContext.

Supported rule types (from Promotion.rules JSONB array):

    flat_per_receipt:
        {"type": "flat_per_receipt", "amount": 100}
        Fixed bonus for any qualifying receipt.

    flat_per_item:
        {"type": "flat_per_item", "sku_ids": [1,2], "amount": 50}
        Fixed bonus for each matching matched item.

    by_sku:
        {"type": "by_sku", "bonuses": {"1": 100, "2": 200}}
        Bonus per SKU id (string keys in JSON) — amount per item matched.

    by_quantity_tier:
        {"type": "by_quantity_tier", "sku_ids": [1], "tiers": [{"qty": 2, "bonus": 50}, {"qty": 5, "bonus": 120}]}
        Tiered bonus based on total quantity of matching SKUs; highest tier wins.

    first_n_receipts:
        {"type": "first_n_receipts", "n": 3, "amount": 500}
        Bonus only for the seller's first N approved receipts under this brand.

All rule functions return the bonus amount in bonus-units (int ≥ 0).
"""

from __future__ import annotations

import logging

from src.bonus_engine.schemas import RuleContext

logger = logging.getLogger(__name__)


def interpret_rule(rule: dict, context: RuleContext) -> int:
    """Evaluate *rule* against *context* and return bonus amount.

    Returns 0 if the rule does not apply.
    Unknown rule types are logged and return 0 (forward-compatible).

    Args:
        rule: A single rule dict from ``Promotion.rules`` JSONB.
        context: Full receipt + seller context.

    Returns:
        Bonus amount (non-negative integer).
    """
    rule_type = rule.get("type", "")

    if rule_type == "flat_per_receipt":
        return _flat_per_receipt(rule, context)
    if rule_type == "flat_per_item":
        return _flat_per_item(rule, context)
    if rule_type == "by_sku":
        return _by_sku(rule, context)
    if rule_type == "by_quantity_tier":
        return _by_quantity_tier(rule, context)
    if rule_type == "first_n_receipts":
        return _first_n_receipts(rule, context)

    logger.warning("bonus_engine.unknown_rule_type: %s", rule_type)
    return 0


# ---------------------------------------------------------------------------
# Individual rule handlers
# ---------------------------------------------------------------------------


def _flat_per_receipt(rule: dict, context: RuleContext) -> int:
    """Return a flat bonus for any receipt."""
    amount = int(rule.get("amount", 0))
    if amount > 0:
        logger.debug("bonus_engine.flat_per_receipt, amount=%d", amount)
    return max(0, amount)


def _flat_per_item(rule: dict, context: RuleContext) -> int:
    """Return flat bonus for each receipt item whose matched_sku_id is in sku_ids."""
    sku_ids: set[int] = {int(sid) for sid in (rule.get("sku_ids") or [])}
    amount_per_item = int(rule.get("amount", 0))
    if not sku_ids or amount_per_item <= 0:
        return 0

    total = 0
    for item in context.receipt_items:
        if item.matched_sku_id is not None and item.matched_sku_id in sku_ids:
            total += amount_per_item
    logger.debug("bonus_engine.flat_per_item, sku_ids=%s, total=%d", sku_ids, total)
    return total


def _by_sku(rule: dict, context: RuleContext) -> int:
    """Return per-SKU bonus based on a {sku_id → bonus_amount} map."""
    bonuses: dict[str, int] = rule.get("bonuses") or {}
    if not bonuses:
        return 0

    total = 0
    for item in context.receipt_items:
        if item.matched_sku_id is not None:
            key = str(item.matched_sku_id)
            bonus = int(bonuses.get(key, 0))
            total += bonus
    logger.debug("bonus_engine.by_sku, total=%d", total)
    return total


def _by_quantity_tier(rule: dict, context: RuleContext) -> int:
    """Return tiered bonus based on total matched-SKU quantity.

    Tiers example: [{"qty": 2, "bonus": 50}, {"qty": 5, "bonus": 120}]
    Highest tier whose ``qty`` ≤ total_qty wins (pick max bonus, not last tier).
    """
    sku_ids: set[int] = {int(sid) for sid in (rule.get("sku_ids") or [])}
    tiers: list[dict] = sorted(rule.get("tiers") or [], key=lambda t: int(t.get("qty", 0)))
    if not sku_ids or not tiers:
        return 0

    total_qty = sum(
        item.qty for item in context.receipt_items if item.matched_sku_id is not None and item.matched_sku_id in sku_ids
    )

    best_bonus = 0
    for tier in tiers:
        required_qty = int(tier.get("qty", 0))
        tier_bonus = int(tier.get("bonus", 0))
        if total_qty >= required_qty:
            best_bonus = max(best_bonus, tier_bonus)

    logger.debug("bonus_engine.by_quantity_tier, qty=%.2f, bonus=%d", total_qty, best_bonus)
    return best_bonus


def _first_n_receipts(rule: dict, context: RuleContext) -> int:
    """Return bonus only for seller's first N receipts under this brand."""
    n = int(rule.get("n", 0))
    amount = int(rule.get("amount", 0))
    if n <= 0 or amount <= 0:
        return 0

    # seller_receipt_count is the count of *previous* approved receipts.
    if context.seller_receipt_count < n:
        logger.debug(
            "bonus_engine.first_n_receipts, n=%d, prev_count=%d, amount=%d",
            n,
            context.seller_receipt_count,
            amount,
        )
        return amount
    return 0
