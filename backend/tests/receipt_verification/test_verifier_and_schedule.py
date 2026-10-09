"""Verification schedule, method rotation and the proverkacheka adapter (respx, no network)."""

from __future__ import annotations

from datetime import UTC, datetime

import httpx
import pytest
import respx
from src.receipt.models import VerificationOutcome, VerificationStatus
from src.receipt_intake.fiscal import validate_fields
from src.receipt_verification.service import (
    PROVIDER_PAUSE,
    PROVIDER_PAUSES,
    RETRY_DELAYS,
    method_for_attempt,
    next_state,
)
from src.receipt_verification.verifier import FakeVerifier, ProverkachekaVerifier

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=UTC)
URL = "https://proverkacheka.com/api/v1/check/get"
DATA = validate_fields(fn="9960440300712345", fd="12345", fp="3826178549", t="20261008T143205", s="1450.00", now=NOW)


def test_methods_rotate_across_attempts() -> None:
    methods = ProverkachekaVerifier.methods
    assert [method_for_attempt(methods, n) for n in range(1, 7)] == [
        "fields", "qrraw", "fields_seconds", "fields", "qrraw", "fields_seconds",
    ]


def test_provider_side_refusals_pause_without_spending_the_budget() -> None:
    for outcome in (VerificationOutcome.rate_limited, VerificationOutcome.blocked):
        status, at = next_state(len(RETRY_DELAYS) + 5, outcome, NOW)  # even past the budget
        assert status == VerificationStatus.retrying.value
        assert at == NOW + PROVIDER_PAUSE


def test_schedule_retries_then_fails() -> None:
    status, at = next_state(1, VerificationOutcome.not_found, NOW)
    assert (status, at) == (VerificationStatus.retrying.value, NOW + RETRY_DELAYS[0])
    status, at = next_state(len(RETRY_DELAYS), VerificationOutcome.error, NOW)
    assert (status, at) == (VerificationStatus.retrying.value, NOW + RETRY_DELAYS[-1])
    assert next_state(len(RETRY_DELAYS) + 1, VerificationOutcome.error, NOW) == (VerificationStatus.failed.value, None)
    assert next_state(4, VerificationOutcome.ok, NOW) == (VerificationStatus.verified.value, None)


def test_request_encodings() -> None:
    assert ProverkachekaVerifier.build_request(DATA, "fields") == {
        "fn": "9960440300712345", "fd": "12345", "fp": "3826178549", "t": "20261008T1432", "s": "1450.00", "n": "1", "qr": "0",
    }
    assert ProverkachekaVerifier.build_request(DATA, "fields_seconds")["t"] == "20261008T143205"
    assert ProverkachekaVerifier.build_request(DATA, "qrraw") == {"qrraw": DATA.canonical_qr}


_OK_BODY = {
    "code": 1,
    "data": {"json": {
        "fiscalDriveNumber": "9960440300712345", "fiscalDocumentNumber": 12345, "fiscalSign": 3826178549,
        "totalSum": 145000, "dateTime": "2026-10-08T14:32:05", "user": "ООО Ромашка", "userInn": "7701234567",
        "items": [{"name": "SWONQ L18000", "quantity": 2, "price": 72500, "sum": 145000}],
    }},
}


@pytest.mark.asyncio
@respx.mock
async def test_proverkacheka_ok_maps_receipt_and_never_records_the_token() -> None:
    route = respx.post(URL).mock(return_value=httpx.Response(200, json=_OK_BODY))
    result = await ProverkachekaVerifier(token="SECRET").verify(DATA, "fields", 1)

    assert result.outcome is VerificationOutcome.ok
    assert result.receipt is not None
    assert result.receipt.shop_name == "ООО Ромашка"
    assert result.receipt.items[0].total == 145000
    assert "token" not in result.request  # history must not leak the API token
    assert b"token=SECRET" in route.calls.last.request.content  # …but the provider gets it


@pytest.mark.asyncio
@respx.mock
@pytest.mark.parametrize(
    ("status", "body", "outcome"),
    [
        (200, {"code": 0, "data": "чек некорректен"}, VerificationOutcome.invalid),
        (200, {"code": 2, "data": "нет данных"}, VerificationOutcome.not_found),
        (200, {"code": 3, "data": "лимит"}, VerificationOutcome.rate_limited),
        (200, {"code": 4, "data": "подождите"}, VerificationOutcome.rate_limited),
        (200, {"code": 5, "data": "прочее"}, VerificationOutcome.error),
        (429, {}, VerificationOutcome.rate_limited),
        (403, {}, VerificationOutcome.blocked),
        (502, {"oops": True}, VerificationOutcome.error),
    ],
)
async def test_proverkacheka_outcomes(status: int, body: dict, outcome: VerificationOutcome) -> None:
    respx.post(URL).mock(return_value=httpx.Response(status, json=body))
    result = await ProverkachekaVerifier(token="t").verify(DATA, "qrraw", 2)
    assert result.outcome is outcome
    assert result.http_status == status


@pytest.mark.asyncio
@respx.mock
async def test_proverkacheka_network_error_is_an_outcome_not_an_exception() -> None:
    respx.post(URL).mock(side_effect=httpx.ConnectTimeout("boom"))
    result = await ProverkachekaVerifier(token="t").verify(DATA, "fields", 1)
    assert result.outcome is VerificationOutcome.error
    assert "ConnectTimeout" in (result.error or "")


@pytest.mark.asyncio
async def test_fake_verifier_rules() -> None:
    fake = FakeVerifier()
    assert (await fake.verify(DATA, "fields", 1)).outcome is VerificationOutcome.ok
    never = validate_fields(fn="9999000000000001", fd="1", fp="1", t="20261008T1000", s="1", now=NOW)
    assert (await fake.verify(never, "fields", 9)).outcome is VerificationOutcome.not_found
    late = validate_fields(fn="9960440300712345", fd="1", fp="10", t="20261008T1000", s="1", now=NOW)
    assert (await fake.verify(late, "fields", 2)).outcome is VerificationOutcome.not_found
    assert (await fake.verify(late, "fields_seconds", 3)).outcome is VerificationOutcome.ok



def test_provider_side_pause_grows_and_caps_at_a_day() -> None:
    """A quota that ran out / no provider at all: 1 h, 3 h, 6 h, 12 h, then daily — not hourly forever."""
    pauses = [next_state(1, VerificationOutcome.rate_limited, NOW, provider_rounds=k)[1] - NOW for k in range(1, 9)]
    assert pauses[:5] == list(PROVIDER_PAUSES)
    assert set(pauses[4:]) == {PROVIDER_PAUSES[-1]}
