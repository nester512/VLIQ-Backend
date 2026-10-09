"""PG integration: QR intake → pipeline → OFD verification attempts → cron retries → history.

Real transactions matter here: claim/record run as two short transactions around
the provider call, and the request-scoped session must not be left in a begun
state (see forbid_blocked_seller history).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from src.receipt.models import Receipt, ReceiptVerificationAttempt
from src.receipt.service import create_qr_receipt
from src.receipt_intake.fiscal import validate_fields
from src.receipt_intake.handlers.api.v1.router import _fallback_to_review, _journey_read, _warnings
from src.receipt_intake.pipeline import process_qr_receipt, stuck_pending_ids
from src.receipt_verification.providers import ProviderRegistry
from src.receipt_verification.service import RETRY_DELAYS, due_receipt_ids, retry_due, run_round
from src.receipt_verification.verifier import FakeVerifier, VerificationResult

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio


def reg(verifier=None) -> ProviderRegistry:
    """Only the stage stub is connected (the seeded fns/proverkacheka/OFD rows have no adapter)."""
    return ProviderRegistry({"fake": verifier or FakeVerifier()})

OTHER_SELLER = 990002
FN = "9960440300712345"


def _data(fp: str = "3826178549", fn: str = FN, t: str | None = None):
    t = t or (datetime.now(UTC) + timedelta(hours=3) - timedelta(hours=1)).strftime("%Y%m%dT%H%M")  # MSK, 1 h ago
    return validate_fields(fn=fn, fd="12345", fp=fp, t=t, s="1450.00")


async def _create(sm: async_sessionmaker[AsyncSession], data, *, seller=SEED_SELLER_ID, key: str | None = None) -> int:
    async with sm() as s:
        receipt, created = await create_qr_receipt(
            s, seller_id=seller, brand_id=SEED_BRAND_ID, data=data, source="telegram_scan", idempotency_key=key
        )
        assert created or key
        return receipt.id


async def _get(sm, rid: int) -> Receipt:
    async with sm() as s:
        return (await s.execute(select(Receipt).where(Receipt.id == rid))).scalar_one()


async def _attempts(sm, rid: int) -> list[ReceiptVerificationAttempt]:
    async with sm() as s:
        rows = await s.execute(
            select(ReceiptVerificationAttempt)
            .where(ReceiptVerificationAttempt.receipt_id == rid)
            .order_by(ReceiptVerificationAttempt.attempt_no)
        )
        return list(rows.scalars())


async def _make_due(sm, rid: int) -> None:
    async with sm() as s, s.begin():
        await s.execute(update(Receipt).where(Receipt.id == rid).values(next_verification_at=datetime.now(UTC) - timedelta(seconds=1)))


async def test_intake_stores_fiscal_identity_and_is_idempotent(session_factory) -> None:
    data = _data()
    rid = await _create(session_factory, data, key="same-key")
    again = await _create(session_factory, data, key="same-key")

    assert again == rid
    r = await _get(session_factory, rid)
    assert (r.status, r.source, r.verification_status) == ("pending", "telegram_scan", "pending")
    assert (r.fn, r.fd, r.fp, r.total_sum) == (FN, "12345", "3826178549", 145000)
    assert r.qr_raw == data.canonical_qr
    assert r.file_url is None  # no files at all
    assert r.attachments == []


async def test_pipeline_verifies_on_first_attempt_and_enriches(session_factory) -> None:
    rid = await _create(session_factory, _data())
    async with session_factory() as s:
        await process_qr_receipt(s, rid, reg())

    r = await _get(session_factory, rid)
    assert r.status == "on_review"  # moderation stays manual
    assert r.verification_status == "verified"
    assert r.verified_at is not None
    assert r.next_verification_at is None
    assert r.shop_name == "ООО «Демо-магазин»"
    assert r.items
    assert r.items[0]["raw_name"].startswith("SWONQ")
    assert r.ofd_response["code"] == 1  # the final answer is stored
    [attempt] = await _attempts(session_factory, rid)
    assert (attempt.attempt_no, attempt.trigger, attempt.outcome, attempt.method) == (1, "pipeline", "ok", "fields")


async def test_retry_path_rotates_methods_until_found(session_factory) -> None:
    rid = await _create(session_factory, _data(fp="10"))  # fake: not found on attempts 1–2
    verifier = FakeVerifier()
    async with session_factory() as s:
        await process_qr_receipt(s, rid, reg(verifier))
    r = await _get(session_factory, rid)
    assert r.verification_status == "retrying"
    assert r.next_verification_at > datetime.now(UTC) + RETRY_DELAYS[0] - timedelta(seconds=30)

    async with session_factory() as s:
        assert rid not in await due_receipt_ids(s)  # not due yet → the cron leaves it alone
    for _ in range(2):
        await _make_due(session_factory, rid)
        async with session_factory() as s:
            assert await retry_due(s, reg(verifier)) == 1

    attempts = await _attempts(session_factory, rid)
    assert [(a.attempt_no, a.method, a.trigger, a.outcome) for a in attempts] == [
        (1, "fields", "pipeline", "not_found"),
        (2, "qrraw", "cron", "not_found"),
        (3, "fields_seconds", "cron", "ok"),
    ]
    assert (await _get(session_factory, rid)).verification_status == "verified"


async def test_exhausted_retries_end_as_failed_and_manual_remains(session_factory) -> None:
    rid = await _create(session_factory, _data(fn="9999000000000001"))  # fake: never found
    verifier = FakeVerifier()
    async with session_factory() as s:
        await process_qr_receipt(s, rid, reg(verifier))
    for _ in RETRY_DELAYS:
        await _make_due(session_factory, rid)
        async with session_factory() as s:
            await retry_due(s, reg(verifier))

    r = await _get(session_factory, rid)
    assert r.verification_status == "failed"
    assert r.verification_attempts == len(RETRY_DELAYS) + 1
    assert r.next_verification_at is None
    assert r.status == "on_review"  # still moderatable by hand


async def test_cron_stops_once_admin_decided(session_factory) -> None:
    rid = await _create(session_factory, _data(fn="9999000000000002"))
    async with session_factory() as s:
        await process_qr_receipt(s, rid, reg())
    async with session_factory() as s, s.begin():
        await s.execute(update(Receipt).where(Receipt.id == rid).values(status="approved"))
    await _make_due(session_factory, rid)

    async with session_factory() as s:
        assert await retry_due(s, reg()) == 0
    assert len(await _attempts(session_factory, rid)) == 1


async def test_admin_can_force_and_a_failed_recheck_never_downgrades_verified(session_factory) -> None:
    class AlwaysError(FakeVerifier):
        async def verify(self, data, method, attempt_no):
            from src.receipt.models import VerificationOutcome  # noqa: PLC0415
            return VerificationResult(VerificationOutcome.error, {"m": method}, error="provider down")

    rid = await _create(session_factory, _data())
    async with session_factory() as s:
        await process_qr_receipt(s, rid, reg())
    async with session_factory() as s:
        result = await run_round(s, rid, reg(AlwaysError()), trigger="admin")
    assert result is not None

    r = await _get(session_factory, rid)
    assert r.verification_status == "verified"
    async with session_factory() as s:
        history = await _journey_read(s, rid, reg())
    checks = [e.check for e in history.events if e.check]
    assert [c.outcome for c in checks] == ["ok", "error"]  # in journey order
    assert checks[1].trigger == "admin"
    assert history.summary.verification_status == "verified"


async def test_duplicates_are_signals_and_warnings_not_blocks(session_factory) -> None:
    data = _data()
    first = await _create(session_factory, data)
    own_again = await _create(session_factory, data)
    async with session_factory() as s, s.begin():
        await s.execute(
            text(
                "INSERT INTO vliq.seller (telegram_id, brand_id, phone_e164, status, created_at) "
                "VALUES (:tid, :bid, '+79990000002', 'active', now()) ON CONFLICT (telegram_id) DO NOTHING"
            ),
            {"tid": OTHER_SELLER, "bid": SEED_BRAND_ID},
        )
    foreign = await _create(session_factory, data, seller=OTHER_SELLER)

    async with session_factory() as s:
        warnings = await _warnings(s, own_again, data)
    assert [w.code for w in warnings] == ["POSSIBLE_DUPLICATE"]

    for rid in (own_again, foreign):
        async with session_factory() as s:
            await process_qr_receipt(s, rid, reg())
    own_signals = {sig["signal"] for sig in (await _get(session_factory, own_again)).fraud_signals}
    foreign_signals = {sig["signal"] for sig in (await _get(session_factory, foreign)).fraud_signals}
    assert "historical_duplicate_fn_fd_fp" in own_signals
    assert "cross_seller_duplicate" in foreign_signals
    assert (await _get(session_factory, first)).status == "pending"  # untouched


async def test_pipeline_job_is_idempotent(session_factory) -> None:
    rid = await _create(session_factory, _data())
    for _ in range(2):  # arq retry / duplicate job
        async with session_factory() as s:
            await process_qr_receipt(s, rid, reg())
    assert len(await _attempts(session_factory, rid)) == 1


async def test_enqueue_failure_fallback_works_on_the_request_session(session_factory) -> None:
    """The SAME session that created the receipt runs the fallback — it must not be
    left inside a transaction (refresh() used to autobegin one → 500)."""
    async with session_factory() as s:
        receipt, _ = await create_qr_receipt(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID, data=_data(), source="manual"
        )
        await _fallback_to_review(s, receipt.id)
    r = await _get(session_factory, receipt.id)
    assert r.status == "on_review"
    assert r.next_verification_at is not None  # armed for the cron

    async with session_factory() as s:
        assert receipt.id in await due_receipt_ids(s)
        await retry_due(s, reg())
    assert (await _get(session_factory, receipt.id)).verification_status == "verified"


async def test_crash_between_review_and_first_attempt_is_picked_up_by_cron(session_factory) -> None:
    rid = await _create(session_factory, _data())
    async with session_factory() as s, s.begin():  # worker died right after this commit
        await s.execute(update(Receipt).where(Receipt.id == rid).values(status="on_review"))
    async with session_factory() as s:
        assert await retry_due(s, reg()) == 1
    [attempt] = await _attempts(session_factory, rid)
    assert attempt.trigger == "cron"


async def test_lost_intake_job_is_rerun_by_the_sweep(session_factory) -> None:
    rid = await _create(session_factory, _data())
    async with session_factory() as s:
        assert rid not in await stuck_pending_ids(s)  # fresh: the job may still be queued
        assert rid in await stuck_pending_ids(s, now=datetime.now(UTC) + timedelta(minutes=11))


async def test_attempt_in_flight_blocks_a_concurrent_admin_check(session_factory) -> None:
    rid = await _create(session_factory, _data())
    async with session_factory() as s, s.begin():
        await s.execute(
            update(Receipt).where(Receipt.id == rid).values(
                status="on_review", verification_locked_until=datetime.now(UTC) + timedelta(minutes=5)
            )
        )
    async with session_factory() as s:
        assert await run_round(s, rid, reg(), trigger="admin") is None
        assert rid not in await due_receipt_ids(s)
    assert await _attempts(session_factory, rid) == []


async def test_provider_limits_do_not_burn_the_retry_budget(session_factory) -> None:
    class Limited(FakeVerifier):
        async def verify(self, data, method, attempt_no):
            from src.receipt.models import VerificationOutcome  # noqa: PLC0415
            return VerificationResult(VerificationOutcome.rate_limited, {"m": method})

    rid = await _create(session_factory, _data())
    async with session_factory() as s:
        await process_qr_receipt(s, rid, reg(Limited()))
    for _ in range(len(RETRY_DELAYS) + 2):
        await _make_due(session_factory, rid)
        async with session_factory() as s:
            await retry_due(s, reg(Limited()))
    r = await _get(session_factory, rid)
    assert r.verification_status == "retrying"  # never «failed» because of the provider
    assert r.verification_failures == 0
