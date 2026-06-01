"""SKU matcher — match OFD item names against a brand's SKU catalog.

Matching priority:
    1. Exact match on ``sku.code`` (normalized).
    2. Exact match on any of ``sku.aliases`` (normalized).
    3. Fuzzy match on ``sku.aliases`` via rapidfuzz (threshold 80).

``MatchResult.confidence`` is 1.0 for exact matches, 0..1 for fuzzy.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass

from src.sku_matcher.normalizer import normalize_name

logger = logging.getLogger(__name__)

_FUZZY_THRESHOLD = 80.0  # rapidfuzz score (0–100)


@dataclass
class MatchResult:
    """Result of a successful SKU match."""

    sku_id: int
    confidence: float  # 1.0 for exact, 0..1 for fuzzy
    matched_alias: str | None  # which alias triggered the match, None for code match


class SkuMatcher:
    """Match a single item name against a catalog of SKUs.

    Relies on :func:`~src.sku_matcher.normalizer.normalize_name` to preprocess
    both the query and the catalog entries before comparison.
    """

    def match(self, item_name: str, skus: Sequence) -> MatchResult | None:
        """Find the best matching SKU for *item_name*.

        Args:
            item_name: Raw product name from an OFD receipt item.
            skus: Sequence of SKU ORM objects (must have ``id``, ``code``, ``aliases``).

        Returns:
            :class:`MatchResult` or ``None`` if no match meets the confidence threshold.
        """
        normalized_query = normalize_name(item_name)
        if not normalized_query:
            return None

        # --- Pass 1: exact match on code ---
        for sku in skus:
            if normalize_name(str(sku.code)) == normalized_query:
                logger.debug("sku_matcher.exact_code, sku_id=%d, code=%s", sku.id, sku.code)
                return MatchResult(sku_id=sku.id, confidence=1.0, matched_alias=None)

        # --- Pass 2: exact match on any alias ---
        for sku in skus:
            aliases: list[str] = sku.aliases or []
            for alias in aliases:
                if normalize_name(alias) == normalized_query:
                    logger.debug("sku_matcher.exact_alias, sku_id=%d, alias=%r", sku.id, alias)
                    return MatchResult(sku_id=sku.id, confidence=1.0, matched_alias=alias)

        # --- Pass 3: fuzzy match on aliases ---
        return self._fuzzy_match(normalized_query, skus)

    @staticmethod
    def _fuzzy_match(normalized_query: str, skus: Sequence) -> MatchResult | None:
        """Run rapidfuzz WRatio against all aliases and return best match."""
        try:
            from rapidfuzz import fuzz
        except ImportError:
            logger.warning("sku_matcher.rapidfuzz_not_installed — fuzzy matching disabled")
            return None

        best_score = 0.0
        best_result: MatchResult | None = None

        for sku in skus:
            aliases: list[str] = sku.aliases or []
            for alias in aliases:
                score = fuzz.WRatio(normalized_query, normalize_name(alias))
                if score > best_score:
                    best_score = score
                    best_result = MatchResult(
                        sku_id=sku.id,
                        confidence=round(score / 100.0, 4),
                        matched_alias=alias,
                    )

        if best_score >= _FUZZY_THRESHOLD:
            logger.debug(
                "sku_matcher.fuzzy_match, sku_id=%d, score=%.1f, alias=%r",
                best_result.sku_id,  # type: ignore[union-attr]
                best_score,
                best_result.matched_alias,  # type: ignore[union-attr]
            )
            return best_result

        logger.debug("sku_matcher.no_match, query=%r, best_score=%.1f", normalized_query, best_score)
        return None
