"""PG integration: the receipt journey — one ordered, reproducible log per receipt.

From intake to the admin's decision: what happened, when, by whom, at which
check provider, with what result; provider fallback within a round; the circuit
breaker; a single-provider re-check; moderation steps written atomically.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.receipt.handlers.api.v1.router import approve_receipt, edit_receipt_bonus
from src.receipt.models import CheckProvider, Receipt, ReceiptEvent, VerificationOutcome
from src.receipt.schemas.api import ReceiptEditBonusRequest, ReceiptReviewAction
from src.receipt.service import create_qr_receipt
from src.receipt_intake.fiscal import validate_fields
from src.receipt_intake.handlers.api.v1.router import _journey_read
from src.receipt_intake.pipeline import process_qr_receipt
from src.receipt_verification.providers import BREAKER_THRESHOLD, ProviderRegistry
from src.receipt_verification.service import run_round
from src.receipt_verification.verifier import FakeVerifier, VerificationResult

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio
ADMIN = {"user_id": 777, "role": "admin"}


class Answer(FakeVerifier):
    """A stub provider with a fixed answer (stands in for proverkacheka in a chain)."""

    def __init__(self, outcome: VerificationOutcome) -> None:
        self.outcome = outcome

    async def verify(self, data, method, attempt_no):
        if self.outcome is VerificationOutcome.ok:
            return await super().verify(data, method, attempt_no)
        return VerificationResult(self.outcome, {"method": method}, response={"code": 5})


def _data(fp: str = "3826178549"):
    t = (datetime.now(UTC) + timedelta(hours=2)).strftime("%Y%m%dT%H%M")
    return validate_fields(fn="9960440300712345", fd="12345", fp=fp, t=t, s="1450.00")


async def _new(sm: async_sessionmaker[AsyncSession], fp: str = "3826178549") -> int:
    async with sm() as s:
        receipt, _ = await create_qr_receipt(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, data=_data(fp), source="image_decode"
        )
        return receipt.id


async def _events(sm, rid: int) -> list[ReceiptEvent]:
    async with sm() as s:
        return list((await s.execute(select(ReceiptEvent).where(ReceiptEvent.receipt_id == rid).order_by(ReceiptEvent.seq))).scalars())


async def test_full_path_is_one_ordered_log(session_factory) -> None:
    from prometheus_client import REGISTRY

    calls_before = REGISTRY.get_sample_value("ofd_requests_total", {"provider": "fake", "status": "ok"}) or 0
    rid = await _new(session_factory)
    async with session_factory() as s:
        await process_qr_receipt(s, rid, ProviderRegistry({"fake": FakeVerifier()}))
    async with session_factory() as s:
        await approve_receipt(rid, ReceiptReviewAction(comment="ок", bonus_amount=5000), ADMIN, s)

    events = await _events(session_factory, rid)
    # Every provider call is also a metric (Prometheus scrapes the pipeline worker).
    assert REGISTRY.get_sample_value("ofd_requests_total", {"provider": "fake", "status": "ok"}) == calls_before + 1
    assert [e.seq for e in events] == list(range(1, len(events) + 1))  # gapless order
    assert [e.kind for e in events] == [
        "received", "validated", "sent_to_moderation", "check_round_started",
        "provider_checked", "verified", "approved",
    ]
    received, *_ = events
    assert (received.actor_type, received.actor_id, received.source) == ("seller", SEED_SELLER_ID, "image_decode")
    checked = events[4]
    assert (checked.source, checked.outcome, checked.check_id is not None) == ("fake", "ok", True)
    assert events[5].source == "fake"
    approved = events[6]
    assert (approved.actor_type, approved.actor_id, approved.data["bonus_amount"]) == ("admin", 777, 5000)


async def test_round_falls_back_to_the_next_provider_in_order(session_factory) -> None:
    rid = await _new(session_factory)
    # proverkacheka (priority 20) answers «not found», the stub (90) confirms.
    registry = ProviderRegistry({"proverkacheka": Answer(VerificationOutcome.not_found), "fake": FakeVerifier()})
    async with session_factory() as s:
        await process_qr_receipt(s, rid, registry)

    async with session_factory() as s:
        j = await _journey_read(s, rid, registry)
    checks = [(e.source, e.outcome, e.check.round_no, e.check.provider_role) for e in j.events if e.kind == "provider_checked"]
    assert checks == [("proverkacheka", "not_found", 1, "main"), ("fake", "ok", 1, "fallback")]
    assert j.summary.verified_by == "fake"
    assert j.summary.check_rounds == 1
    started = next(e for e in j.events if e.kind == "check_round_started")
    assert started.data["providers"] == ["proverkacheka", "fake"]  # ФНС not connected → not in the round
    available = {p.code: p.available for p in j.providers}
    assert available == {"fns": False, "proverkacheka": True, "platformaofd": False, "taxcom": False, "fake": True}


async def test_every_check_is_reproducible(session_factory) -> None:
    rid = await _new(session_factory)
    async with session_factory() as s:
        await process_qr_receipt(s, rid, ProviderRegistry({"fake": FakeVerifier()}))
    async with session_factory() as s:
        j = await _journey_read(s, rid, ProviderRegistry({"fake": FakeVerifier()}))
    check = next(e.check for e in j.events if e.check)
    assert check.request["fn"] == "9960440300712345"  # the exact request…
    assert check.response["code"] == 1  # …the raw answer as received…
    assert check.parsed["total_sum"] == 145000  # …and the normalised one
    assert check.adapter_version == "1"
    assert check.method == "fields"


async def test_breaker_skips_a_failing_provider_and_says_so(session_factory) -> None:
    registry = ProviderRegistry({"proverkacheka": Answer(VerificationOutcome.error), "fake": FakeVerifier()})
    for _ in range(BREAKER_THRESHOLD):
        rid = await _new(session_factory, fp=str(1000 + _) + "7")
        async with session_factory() as s:
            await process_qr_receipt(s, rid, registry)
    async with session_factory() as s:
        row = (await s.execute(select(CheckProvider).where(CheckProvider.code == "proverkacheka"))).scalar_one()
    assert row.disabled_until is not None

    rid = await _new(session_factory, fp="99997")
    async with session_factory() as s:
        await process_qr_receipt(s, rid, registry)
    kinds = [(e.kind, e.source) for e in await _events(session_factory, rid)]
    assert ("provider_skipped", "proverkacheka") in kinds
    assert ("provider_checked", "proverkacheka") not in kinds
    assert ("verified", "fake") in kinds
    async with session_factory() as s, s.begin():  # leave the registry clean for other tests
        await s.execute(update(CheckProvider).values(disabled_until=None, consecutive_failures=0))


async def test_admin_recheck_at_one_provider(session_factory) -> None:
    rid = await _new(session_factory, fp="10")  # stub: found only from round 3
    registry = ProviderRegistry({"proverkacheka": Answer(VerificationOutcome.not_found), "fake": FakeVerifier()})
    async with session_factory() as s:
        await process_qr_receipt(s, rid, registry)  # round 1: both miss
    async with session_factory() as s:
        await run_round(s, rid, registry, trigger="admin", actor_id=777, only_provider="fake")  # round 2
    async with session_factory() as s:
        await run_round(s, rid, registry, trigger="admin", actor_id=777, only_provider="fake")  # round 3

    events = await _events(session_factory, rid)
    rounds = [e.data for e in events if e.kind == "check_round_started"]
    assert [r["providers"] for r in rounds] == [["proverkacheka", "fake"], ["fake"], ["fake"]]
    assert rounds[1]["only"] == "fake"
    forced = [e for e in events if e.kind == "provider_checked" and e.actor_type == "admin"]
    assert {e.actor_id for e in forced} == {777}
    assert events[-1].kind == "verified"


async def test_no_connected_provider_is_recorded_not_silent(session_factory) -> None:
    rid = await _new(session_factory)
    async with session_factory() as s:
        await process_qr_receipt(s, rid, ProviderRegistry({}))  # production today: nothing connected
    events = await _events(session_factory, rid)
    failed = events[-1]
    assert failed.kind == "check_round_failed"
    assert failed.data["reason"] == "no_provider_available"
    async with session_factory() as s:
        r = (await s.execute(select(Receipt).where(Receipt.id == rid))).scalar_one()
    assert r.status == "on_review"  # manual moderation still works
    assert r.verification_failures == 0  # no provider ≠ the receipt's fault


async def test_bonus_edit_is_a_journey_step(session_factory) -> None:
    rid = await _new(session_factory)
    async with session_factory() as s:
        await process_qr_receipt(s, rid, ProviderRegistry({"fake": FakeVerifier()}))
    async with session_factory() as s:
        await approve_receipt(rid, ReceiptReviewAction(bonus_amount=5000), ADMIN, s)
    async with session_factory() as s:
        await edit_receipt_bonus(rid, ReceiptEditBonusRequest(bonus_amount=7000), ADMIN, s)
    last = (await _events(session_factory, rid))[-1]
    assert (last.kind, last.data) == ("bonus_changed", {"before": 5000, "after": 7000})
