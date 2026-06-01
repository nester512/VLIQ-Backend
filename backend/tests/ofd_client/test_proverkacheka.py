"""Unit tests for ProverkachekaClient.

All HTTP calls are mocked with respx — NO real network access.

Coverage:
    - Successful response → OFDReceipt mapping.
    - Response code 2 (not found) → OFDNotFoundError.
    - Response code 3 (blocked) → OFDBlockedError.
    - HTTP 404 → OFDNotFoundError.
    - HTTP 401 / 403 → OFDBlockedError (no retry).
    - HTTP 429 with Retry-After header → respects delay, retries.
    - HTTP 429 without Retry-After → exponential backoff, retries.
    - HTTP 429 on every attempt → OFDRateLimitError after max_attempts.
    - HTTP 5xx transient → exponential backoff, retries.
    - HTTP 5xx on every attempt → OFDBlockedError after max_attempts.
    - Connection timeout on every attempt → OFDBlockedError.
    - Response mapping: items, kopeck amounts, invalid dateTime fallback.
    - Missing fields → safe defaults (no crash).
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest
import respx
from src.ofd_client.exceptions import (
    OFDBlockedError,
    OFDNotFoundError,
    OFDRateLimitError,
)
from src.ofd_client.proverkacheka import ProverkachekaClient
from src.ofd_client.schemas import OFDReceipt

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

_FIXTURES = Path(__file__).parent.parent / "fixtures" / "proverkacheka_responses"
_ENDPOINT = "https://proverkacheka.com/api/v1/check/get"

_FN = "9960440300115271"
_FD = "41234"
_FP = "2093842751"

_VALID_RECEIPT = json.loads((_FIXTURES / "valid_receipt.json").read_text())
_NOT_FOUND = json.loads((_FIXTURES / "not_found.json").read_text())
_BLOCKED = json.loads((_FIXTURES / "blocked.json").read_text())

# Target for patching asyncio.sleep inside the proverkacheka module.
_SLEEP_TARGET = "src.ofd_client.proverkacheka.asyncio.sleep"


def _make_client(
    http_client: httpx.AsyncClient,
    *,
    max_attempts: int = 3,
) -> ProverkachekaClient:
    return ProverkachekaClient(
        token="test-token",
        timeout=5.0,
        max_attempts=max_attempts,
        http_client=http_client,
    )


async def _get(client: ProverkachekaClient) -> OFDReceipt:
    return await client.get_receipt(
        fn=_FN,
        fd=_FD,
        fp=_FP,
        total_sum=59900,
        purchase_date="2026-04-10T14:30:00",
    )


@asynccontextmanager
async def _no_sleep():
    """Context manager that patches asyncio.sleep to return immediately."""
    with patch(_SLEEP_TARGET, new_callable=AsyncMock) as mock_sleep:
        yield mock_sleep


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_valid_response__returns_ofd_receipt():
    """A code=1 response maps fully to OFDReceipt."""
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=_VALID_RECEIPT))
        async with httpx.AsyncClient() as http:
            receipt = await _get(_make_client(http))

    assert isinstance(receipt, OFDReceipt)
    assert receipt.fn == _FN
    assert receipt.total_sum == 59900  # kopecks as-is
    assert receipt.shop_name == 'ООО "Ромашка"'
    assert receipt.shop_inn == "7701234567"
    assert receipt.shop_address == "г. Москва, ул. Арбат, д. 10"
    assert len(receipt.items) == 2


@pytest.mark.asyncio
async def test_items_mapping__kopecks_and_names():
    """Items are mapped correctly: price/total in kopecks, names preserved."""
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=_VALID_RECEIPT))
        async with httpx.AsyncClient() as http:
            receipt = await _get(_make_client(http))

    item0, item1 = receipt.items
    assert item0.name == "Кофе латте"
    assert item0.price == 35000  # kopecks
    assert item0.total == 35000
    assert item0.quantity == 1.0
    assert item0.nds_rate == 20

    assert item1.name == "Круассан"
    assert item1.quantity == 2.0
    assert item1.price == 12450
    assert item1.total == 24900


@pytest.mark.asyncio
async def test_valid_response__datetime_parsed():
    """dateTime string is parsed to a datetime object."""
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=_VALID_RECEIPT))
        async with httpx.AsyncClient() as http:
            receipt = await _get(_make_client(http))

    assert isinstance(receipt.purchase_date, datetime)
    assert receipt.purchase_date.year == 2026
    assert receipt.purchase_date.month == 4
    assert receipt.purchase_date.day == 10


@pytest.mark.asyncio
async def test_invalid_datetime__falls_back_to_now():
    """If dateTime is garbage, parser falls back to now() and does not crash."""
    bad = {
        "code": 1,
        "data": {"json": {"fiscalDriveNumber": _FN, "totalSum": 0, "dateTime": "NOT_A_DATE", "items": []}},
    }
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=bad))
        async with httpx.AsyncClient() as http:
            receipt = await _get(_make_client(http))

    assert isinstance(receipt.purchase_date, datetime)


@pytest.mark.asyncio
async def test_missing_items__returns_empty_list():
    """If items key is absent, items defaults to []."""
    payload = {
        "code": 1,
        "data": {"json": {"fiscalDriveNumber": _FN, "totalSum": 1000, "dateTime": "2026-01-01T00:00:00"}},
    }
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=payload))
        async with httpx.AsyncClient() as http:
            receipt = await _get(_make_client(http))

    assert receipt.items == []


@pytest.mark.asyncio
async def test_missing_optional_fields__safe_defaults():
    """shop_name, shop_inn, shop_address are None when absent."""
    payload = {
        "code": 1,
        "data": {"json": {"totalSum": 0, "dateTime": "2026-01-01T10:00:00", "items": []}},
    }
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=payload))
        async with httpx.AsyncClient() as http:
            receipt = await _get(_make_client(http))

    assert receipt.shop_name is None
    assert receipt.shop_inn is None
    assert receipt.shop_address is None


# ---------------------------------------------------------------------------
# Application-level error codes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_code_2__raises_ofd_not_found():
    """code=2 → OFDNotFoundError."""
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=_NOT_FOUND))
        async with httpx.AsyncClient() as http:
            with pytest.raises(OFDNotFoundError):
                await _get(_make_client(http))


@pytest.mark.asyncio
async def test_code_3__raises_ofd_blocked():
    """code=3 → OFDBlockedError."""
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=_BLOCKED))
        async with httpx.AsyncClient() as http:
            with pytest.raises(OFDBlockedError):
                await _get(_make_client(http))


@pytest.mark.asyncio
async def test_unexpected_code__raises_ofd_blocked():
    """Unknown code → OFDBlockedError."""
    payload = {"code": 99, "data": {}}
    with respx.mock:
        respx.post(_ENDPOINT).mock(return_value=httpx.Response(200, json=payload))
        async with httpx.AsyncClient() as http:
            with pytest.raises(OFDBlockedError):
                await _get(_make_client(http))


# ---------------------------------------------------------------------------
# HTTP error codes — no-retry cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_http_401__raises_blocked_no_retry():
    """HTTP 401 → OFDBlockedError immediately (1 attempt only, no retry)."""
    call_count = 0

    with respx.mock:

        def _handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            return httpx.Response(401)

        respx.post(_ENDPOINT).mock(side_effect=_handler)
        async with httpx.AsyncClient() as http:
            with pytest.raises(OFDBlockedError, match="401"):
                await _get(_make_client(http, max_attempts=3))

    assert call_count == 1, "401 must not be retried"


@pytest.mark.asyncio
async def test_http_403__raises_blocked_no_retry():
    """HTTP 403 → OFDBlockedError immediately."""
    call_count = 0

    with respx.mock:

        def _handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            return httpx.Response(403)

        respx.post(_ENDPOINT).mock(side_effect=_handler)
        async with httpx.AsyncClient() as http:
            with pytest.raises(OFDBlockedError, match="403"):
                await _get(_make_client(http, max_attempts=3))

    assert call_count == 1, "403 must not be retried"


@pytest.mark.asyncio
async def test_http_404__raises_ofd_not_found_no_retry():
    """HTTP 404 → OFDNotFoundError immediately."""
    call_count = 0

    with respx.mock:

        def _handler(request: httpx.Request) -> httpx.Response:
            nonlocal call_count
            call_count += 1
            return httpx.Response(404)

        respx.post(_ENDPOINT).mock(side_effect=_handler)
        async with httpx.AsyncClient() as http:
            with pytest.raises(OFDNotFoundError):
                await _get(_make_client(http, max_attempts=3))

    assert call_count == 1, "404 must not be retried"


# ---------------------------------------------------------------------------
# HTTP 429 — rate limit with retry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_http_429__success_on_retry():
    """HTTP 429 on first attempt, then success → returns OFDReceipt."""
    attempt = 0

    async with _no_sleep():
        with respx.mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                nonlocal attempt
                attempt += 1
                if attempt == 1:
                    return httpx.Response(429)
                return httpx.Response(200, json=_VALID_RECEIPT)

            respx.post(_ENDPOINT).mock(side_effect=_handler)
            async with httpx.AsyncClient() as http:
                receipt = await _get(_make_client(http, max_attempts=3))

    assert isinstance(receipt, OFDReceipt)
    assert attempt == 2


@pytest.mark.asyncio
async def test_http_429_with_retry_after_header():
    """Retry-After header value is passed to asyncio.sleep."""
    attempt = 0

    async with _no_sleep() as mock_sleep:
        with respx.mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                nonlocal attempt
                attempt += 1
                if attempt == 1:
                    return httpx.Response(429, headers={"Retry-After": "7"})
                return httpx.Response(200, json=_VALID_RECEIPT)

            respx.post(_ENDPOINT).mock(side_effect=_handler)
            async with httpx.AsyncClient() as http:
                await _get(_make_client(http, max_attempts=3))

    mock_sleep.assert_awaited_once()
    called_with = mock_sleep.call_args[0][0]
    assert called_with == 7.0, f"Expected sleep(7.0) from Retry-After, got {called_with}"


@pytest.mark.asyncio
async def test_http_429_all_attempts__raises_rate_limit():
    """HTTP 429 on all 3 attempts → OFDRateLimitError."""
    async with _no_sleep():
        with respx.mock:
            respx.post(_ENDPOINT).mock(return_value=httpx.Response(429))
            async with httpx.AsyncClient() as http:
                with pytest.raises(OFDRateLimitError):
                    await _get(_make_client(http, max_attempts=3))


# ---------------------------------------------------------------------------
# HTTP 5xx — transient server error with retry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_http_500__success_on_second_attempt():
    """HTTP 500 on first attempt, then 200 → returns receipt."""
    attempt = 0

    async with _no_sleep():
        with respx.mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                nonlocal attempt
                attempt += 1
                if attempt == 1:
                    return httpx.Response(500)
                return httpx.Response(200, json=_VALID_RECEIPT)

            respx.post(_ENDPOINT).mock(side_effect=_handler)
            async with httpx.AsyncClient() as http:
                receipt = await _get(_make_client(http, max_attempts=3))

    assert isinstance(receipt, OFDReceipt)
    assert attempt == 2


@pytest.mark.asyncio
async def test_http_503_all_attempts__raises_blocked():
    """HTTP 503 on all attempts → OFDBlockedError after max_attempts."""
    call_count = 0

    async with _no_sleep():
        with respx.mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                nonlocal call_count
                call_count += 1
                return httpx.Response(503)

            respx.post(_ENDPOINT).mock(side_effect=_handler)
            async with httpx.AsyncClient() as http:
                with pytest.raises(OFDBlockedError):
                    await _get(_make_client(http, max_attempts=3))

    assert call_count == 3


# ---------------------------------------------------------------------------
# Network-level errors — timeout / connect
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_timeout_all_attempts__raises_blocked():
    """Read timeout on all attempts → OFDBlockedError."""
    call_count = 0

    async with _no_sleep():
        with respx.mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                nonlocal call_count
                call_count += 1
                raise httpx.ReadTimeout("timed out", request=request)

            respx.post(_ENDPOINT).mock(side_effect=_handler)
            async with httpx.AsyncClient() as http:
                with pytest.raises(OFDBlockedError):
                    await _get(_make_client(http, max_attempts=3))

    assert call_count == 3


@pytest.mark.asyncio
async def test_timeout__success_on_second_attempt():
    """Timeout on first, then success → returns receipt."""
    attempt = 0

    async with _no_sleep():
        with respx.mock:

            def _handler(request: httpx.Request) -> httpx.Response:
                nonlocal attempt
                attempt += 1
                if attempt == 1:
                    raise httpx.ReadTimeout("timed out", request=request)
                return httpx.Response(200, json=_VALID_RECEIPT)

            respx.post(_ENDPOINT).mock(side_effect=_handler)
            async with httpx.AsyncClient() as http:
                receipt = await _get(_make_client(http, max_attempts=3))

    assert isinstance(receipt, OFDReceipt)


# ---------------------------------------------------------------------------
# max_attempts=1 — disables retry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_max_attempts_1__no_retry_on_429():
    """max_attempts=1 → single attempt, 429 immediately raises OFDRateLimitError."""
    async with _no_sleep():
        with respx.mock:
            respx.post(_ENDPOINT).mock(return_value=httpx.Response(429))
            async with httpx.AsyncClient() as http:
                with pytest.raises(OFDRateLimitError):
                    await _get(_make_client(http, max_attempts=1))


# ---------------------------------------------------------------------------
# Backoff helper
# ---------------------------------------------------------------------------


def test_backoff__exponential():
    """_backoff produces 1, 2, 4, …, capped at 60."""
    from src.ofd_client.proverkacheka import _backoff

    assert _backoff(1) == 1.0
    assert _backoff(2) == 2.0
    assert _backoff(3) == 4.0
    assert _backoff(10) == 60.0  # capped
