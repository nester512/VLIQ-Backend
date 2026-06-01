"""Name normalization for SKU matching.

Strips measurement units and common noise so that 'Молоко 1 л' matches 'молоко'.
"""

from __future__ import annotations

import re

# Units to strip (word-boundary aware, case-insensitive).
_UNIT_PATTERN = re.compile(
    r"\b(\d+[\.,]?\d*\s*)?(мл|кг|гр|г|шт|уп|л|литр|litres?|ml|kg|g|pcs?|pc)\b",
    flags=re.IGNORECASE | re.UNICODE,
)

# Collapse multiple spaces.
_SPACE_PATTERN = re.compile(r"\s+")

# Strip non-alphanumeric (Cyrillic + Latin + digits) except space.
_NOISE_PATTERN = re.compile(r"[^\w\s]", flags=re.UNICODE)


def normalize_name(s: str) -> str:
    """Normalize a product name for fuzzy matching.

    Steps:
        1. Lowercase.
        2. Remove measurement units and quantities (мл, г, шт, …).
        3. Remove punctuation and special characters.
        4. Collapse repeated whitespace and strip edges.

    Args:
        s: Raw product name from OFD response or SKU catalog.

    Returns:
        Normalized string, e.g. ``'Молоко 1л'`` → ``'молоко'``.
    """
    s = s.lower()
    s = _UNIT_PATTERN.sub(" ", s)
    s = _NOISE_PATTERN.sub(" ", s)
    s = _SPACE_PATTERN.sub(" ", s)
    return s.strip()
