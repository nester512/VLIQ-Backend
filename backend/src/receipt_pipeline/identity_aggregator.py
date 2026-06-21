"""Aggregate fiscal-identity candidates across one submission (the package).

A submission yields raw QR strings from several sources — the scanned QR, every
image attachment, and every PDF page. This module parses each into a confident
:class:`FiscalIdentity` (or ``None``) and decides whether the package contains
0, 1, or >1 *distinct* confident receipts. Only the count of distinct confident
identities drives the decision — repeats of the same identity are normal (the same
receipt photographed five times), and indirect/incomplete reads never count.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from src.receipt_ocr.fiscal_identity import FiscalIdentity, normalize_fiscal_identity
from src.receipt_ocr.qr_parser import QRParseError, parse_qr_string


@dataclass(frozen=True)
class Candidate:
    """One decoded QR string and the confident identity it yields (if any)."""

    source: str  # e.g. "scanned_qr", "attachment[0]", "attachment[1]:page2"
    raw_qr: str
    identity: FiscalIdentity | None


@dataclass
class AggregationResult:
    candidates: list[Candidate] = field(default_factory=list)
    unique_identities: list[FiscalIdentity] = field(default_factory=list)

    @property
    def primary(self) -> FiscalIdentity | None:
        """The single confident identity, when exactly one was found."""
        return self.unique_identities[0] if len(self.unique_identities) == 1 else None

    @property
    def decision(self) -> str:
        """``"none"`` (0), ``"single"`` (1), or ``"multiple"`` (>1)."""
        n = len(self.unique_identities)
        return "none" if n == 0 else "single" if n == 1 else "multiple"

    def raw_for(self, identity: FiscalIdentity) -> str | None:
        """First raw QR string that produced *identity* (for downstream OFD lookup)."""
        for c in self.candidates:
            if c.identity == identity:
                return c.raw_qr
        return None


def aggregate_identities(raw_by_source: list[tuple[str, str]]) -> AggregationResult:
    """Build an :class:`AggregationResult` from ``(source_label, raw_qr)`` pairs.

    Each raw string is parsed (``parse_qr_string`` → ``normalize_fiscal_identity``);
    unparseable or incomplete reads become candidates with ``identity=None`` and do
    not affect the distinct-identity count. Distinct confident identities are
    de-duplicated while preserving first-seen order.
    """
    candidates: list[Candidate] = []
    unique: list[FiscalIdentity] = []
    seen: set[FiscalIdentity] = set()

    for source, raw in raw_by_source:
        identity: FiscalIdentity | None = None
        try:
            parsed = parse_qr_string(raw)
            identity = normalize_fiscal_identity(parsed.fn, parsed.fd, parsed.fp)
        except QRParseError:
            identity = None
        candidates.append(Candidate(source=source, raw_qr=raw, identity=identity))
        if identity is not None and identity not in seen:
            seen.add(identity)
            unique.append(identity)

    return AggregationResult(candidates=candidates, unique_identities=unique)
