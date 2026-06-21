"""Fiscal identity normalization — the single source of truth for "same receipt".

A confident fiscal identity is the normalized triple ``(fn, fd, fp)``. Two receipts
are the *same* fiscal receipt iff their normalized identities are equal. This module
is deliberately tiny and pure so it can be unit-tested in isolation and reused by the
pipeline aggregator and the fraud checks alike.

Normalization rules (kept in ONE place):
- strip surrounding/embedded whitespace and any separator/format noise
  (only ``[0-9A-Za-z]`` is kept), then upper-case;
- an identity is **confident only when all three** components are present and
  non-empty after normalization — an incomplete triple is NOT a confident identity
  (so a partially-read QR never collides with a real one).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Format noise = anything that is not an alphanumeric character (whitespace, dashes,
# dots, etc.). fn/fd/fp are numeric in practice; keeping alnum is safe and stable.
_NOISE = re.compile(r"[^0-9A-Za-z]+")


def _normalize_component(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = _NOISE.sub("", value).upper()
    return cleaned or None


@dataclass(frozen=True)
class FiscalIdentity:
    """A confident, normalized fiscal receipt identity. Hashable → usable in a set."""

    fn: str
    fd: str
    fp: str

    def as_tuple(self) -> tuple[str, str, str]:
        return (self.fn, self.fd, self.fp)


def normalize_fiscal_identity(fn: str | None, fd: str | None, fp: str | None) -> FiscalIdentity | None:
    """Normalize ``(fn, fd, fp)`` into a :class:`FiscalIdentity`.

    Returns ``None`` when the triple is incomplete after normalization (any of the
    three components missing/empty) — an incomplete triple is not a confident identity.
    """
    nfn = _normalize_component(fn)
    nfd = _normalize_component(fd)
    nfp = _normalize_component(fp)
    if not (nfn and nfd and nfp):
        return None
    return FiscalIdentity(fn=nfn, fd=nfd, fp=nfp)
