"""Check-provider registry: which sources confirm a receipt, in which order.

The order and on/off switch live in ``check_provider`` (owner-editable without a
release). A provider is actually called only if THIS deployment also has its
adapter (credentials / implementation) — otherwise it is listed as «не подключён».
A provider failing again and again is skipped for a while (circuit breaker).

Default order (owner decision 2026-10-09): ФНС → proverkacheka → OFD operators.
Connected today: proverkacheka (with a token) and the stage/dev stub.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.receipt.models import CheckProvider, VerificationOutcome
from src.receipt_verification.verifier import FakeVerifier, ProverkachekaVerifier, Verifier

BREAKER_THRESHOLD = 5  # consecutive provider-side failures …
BREAKER_PAUSE = timedelta(minutes=15)  # … switch the provider off for this long
# Outcomes that say something about the PROVIDER, not the receipt.
PROVIDER_FAULTS = frozenset({VerificationOutcome.error, VerificationOutcome.blocked, VerificationOutcome.rate_limited})


@dataclass
class ProviderSlot:
    row: CheckProvider
    verifier: Verifier


class ProviderRegistry:
    """Adapters available in this deployment, keyed by provider code."""

    def __init__(self, adapters: dict[str, Verifier]) -> None:
        self.adapters = adapters

    @classmethod
    def from_settings(
        cls, *, provider: str, token: str | None, stub: bool = False, timeout: float = 10.0
    ) -> ProviderRegistry:
        adapters: dict[str, Verifier] = {}
        if token:
            adapters["proverkacheka"] = ProverkachekaVerifier(token=token, timeout=timeout)
        if stub:
            # Explicit opt-in only (CHECK_PROVIDER_STUB, stage overlay). OFD_PROVIDER=fake
            # alone is NOT enough: production runs with it and must never be «confirmed» by a stub.
            adapters["fake"] = FakeVerifier()
        if provider == "proverkacheka" and "proverkacheka" not in adapters:
            raise RuntimeError("PROVERKACHEKA_TOKEN must be set when OFD_PROVIDER=proverkacheka")
        return cls(adapters)

    async def rows(self, session: AsyncSession) -> list[CheckProvider]:
        return list((await session.execute(select(CheckProvider).order_by(CheckProvider.priority))).scalars())

    async def chain(
        self, session: AsyncSession, now: datetime, *, only: str | None = None
    ) -> tuple[list[ProviderSlot], list[CheckProvider]]:
        """(providers to call in order, providers skipped by the circuit breaker)."""
        call: list[ProviderSlot] = []
        skipped: list[CheckProvider] = []
        for row in await self.rows(session):
            if only is not None and row.code != only:
                continue
            if row.code not in self.adapters or (not row.enabled and only is None):
                continue
            if only is None and row.disabled_until is not None and row.disabled_until > now:
                skipped.append(row)
                continue
            call.append(ProviderSlot(row, self.adapters[row.code]))
        return call, skipped

    def is_available(self, code: str) -> bool:
        return code in self.adapters


def register_outcome(row: CheckProvider, outcome: VerificationOutcome, now: datetime) -> None:
    """Circuit breaker bookkeeping — call inside the transaction that records the attempt."""
    if outcome in PROVIDER_FAULTS:
        row.consecutive_failures += 1
        if row.consecutive_failures >= BREAKER_THRESHOLD:
            row.disabled_until = now + BREAKER_PAUSE
            row.consecutive_failures = 0
    else:  # ok / not_found / invalid: the provider works, the answer is about the receipt
        row.consecutive_failures = 0
        row.disabled_until = None
    row.updated_at = now
