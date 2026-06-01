"""OFD client exceptions."""

from __future__ import annotations


class OFDError(Exception):
    """Base class for all OFD client errors."""


class OFDNotFoundError(OFDError):
    """The receipt was not found in the OFD system (ФНС returned no data)."""


class OFDBlockedError(OFDError):
    """The OFD provider blocked the request (too many errors for this receipt).

    The caller should schedule a retry and move the receipt to `on_review`.
    """


class OFDRateLimitError(OFDError):
    """The OFD provider returned HTTP 429 — slow down requests."""
