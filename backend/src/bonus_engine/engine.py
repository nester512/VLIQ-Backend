"""Bonus engine — orchestrate promotion rule evaluation over a receipt.

Usage::

    result = calculate_bonus(
        items=receipt_items,
        active_promotions=promotions,
        sku_catalog=skus,
        context=rule_context,
    )
    # result.total_amount — kopecks to credit
    # result.breakdown   — per-promotion breakdown for audit

Promotion priority: higher ``priority`` value runs first.
``stackable=False`` (default False): first matching promotion stops the chain.
``stackable=True``: all matching promotions accumulate.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from src.bonus_engine.rule_interpreter import interpret_rule
from src.bonus_engine.schemas import AppliedPromotion, BonusResult, RuleContext

logger = logging.getLogger(__name__)


def calculate_bonus(
    *,
    active_promotions: Sequence,
    context: RuleContext,
) -> BonusResult:
    """Calculate total bonus for a receipt.

    Args:
        active_promotions: ORM Promotion objects (must have ``id``, ``rules``,
            ``priority``, ``stackable``). Only promotions already filtered to
            the relevant brand/date range should be passed in.
        context: Shared :class:`~src.bonus_engine.schemas.RuleContext`.

    Returns:
        :class:`~src.bonus_engine.schemas.BonusResult` with ``total_amount``
        and per-promotion ``breakdown``.
    """
    # Sort by priority descending — higher priority runs first.
    sorted_promos = sorted(active_promotions, key=lambda p: int(getattr(p, "priority", 0)), reverse=True)

    breakdown: list[AppliedPromotion] = []
    total = 0

    for promo in sorted_promos:
        promo_id = int(promo.id)
        rules: list[dict] = promo.rules or []
        stackable: bool = bool(getattr(promo, "stackable", False))

        promo_total = 0
        for idx, rule in enumerate(rules):
            amount = interpret_rule(rule, context)
            if amount > 0:
                breakdown.append(
                    AppliedPromotion(
                        promotion_id=promo_id,
                        rule_index=idx,
                        amount=amount,
                        reason=f"{rule.get('type', 'unknown')} rule[{idx}] → {amount}",
                    )
                )
                promo_total += amount

        if promo_total > 0:
            total += promo_total
            logger.debug(
                "bonus_engine.promo_applied, promo_id=%d, amount=%d, stackable=%s",
                promo_id,
                promo_total,
                stackable,
            )
            if not stackable:
                logger.debug("bonus_engine.chain_stopped, promo_id=%d (stackable=False)", promo_id)
                break

    logger.info("bonus_engine.result, total=%d, promos=%d", total, len(breakdown))
    return BonusResult(total_amount=total, breakdown=breakdown)
