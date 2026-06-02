"""Seller-specific error helpers.

Centralises detection of the ``phone_e164`` unique-constraint conflict so the
repository and the API handlers share one robust check instead of duplicating
fragile substring matching across four call sites.
"""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError

# Unique constraint on seller.phone_e164 (migrations/alembic/versions/0001_initial.py).
PHONE_CONSTRAINT = "seller_phone_e164_key"


def is_phone_conflict(exc: IntegrityError) -> bool:
    """True when an IntegrityError stems from the seller.phone_e164 unique constraint.

    asyncpg raises ``UniqueViolationError`` carrying a ``constraint_name`` attribute;
    SQLAlchemy wraps it and exposes the original via ``exc.orig`` (occasionally nested
    under ``exc.orig.__cause__``). We prefer the constraint name (precise) and fall back
    to substring matching on the error text (robust to driver/version differences).
    """
    orig = getattr(exc, "orig", None)
    cause = getattr(orig, "__cause__", None) or orig
    constraint = getattr(cause, "constraint_name", None)
    if constraint:
        return constraint == PHONE_CONSTRAINT
    text = str(orig if orig is not None else exc).lower()
    return "phone_e164" in text
