"""Fraud signal dataclass — stored in receipt.fraud_signals JSONB."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class FraudSignal:
    """A single fraud/anomaly signal recorded against a receipt.

    Serialised to JSONB via :meth:`to_dict`.

    Attributes:
        signal: Machine-readable signal code, e.g. ``file_hash_duplicate``.
        severity: ``"low"`` | ``"medium"`` | ``"high"`` | ``"critical"``.
        duplicate_of_id: ID of the conflicting receipt if applicable.
        details: Arbitrary extra context (JSON-serialisable).
    """

    signal: str
    severity: str
    duplicate_of_id: int | None = None
    details: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return JSON-serialisable dict for storage in JSONB column."""
        return asdict(self)


# Severity constants for consistent use across checks.
SEVERITY_LOW = "low"
SEVERITY_MEDIUM = "medium"
SEVERITY_HIGH = "high"
SEVERITY_CRITICAL = "critical"
