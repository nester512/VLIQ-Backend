"""ProverkachekaClient — production OFD provider via proverkacheka.com.

API reference: https://proverkacheka.com/api
Token: obtained from proverkacheka.com; set via ``settings.PROVERKACHEKA_TOKEN``.

Timeout and retry are injected from settings (``OFD_TIMEOUT_SECONDS``,
``OFD_RETRY_MAX_ATTEMPTS``) — not hardcoded.

Retry policy:
  - HTTP 429: honour ``Retry-After`` header; exponential backoff otherwise.
  - HTTP 5xx / network timeout / connection error: exponential backoff (1 s, 2 s, 4 s …).
  - HTTP 401 / 403: raise OFDBlockedError immediately (no retry — bad token).
  - HTTP 404: raise OFDNotFoundError immediately.
  - All other non-2xx: raise OFDBlockedError.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING

import httpx

from src.app.prometheus_metrics import ofd_request_duration_seconds, ofd_requests_total
from src.ofd_client.exceptions import OFDBlockedError, OFDNotFoundError, OFDRateLimitError
from src.ofd_client.schemas import OFDItem, OFDReceipt

if TYPE_CHECKING:
    from datetime import datetime

logger = logging.getLogger(__name__)

_API_ENDPOINT = "https://proverkacheka.com/api/v1/check/get"

# proverkacheka.com application-level response codes.
_CODE_OK = 1
# proverkacheka.com is loose with codes — codes 2, 4, 5 all mean the receipt
# couldn't be retrieved (not yet registered, no data, etc). Code 3 means the
# API itself blocked the call. All "no data" codes are treated as NOT_FOUND so
# the pipeline can set status=needs_revision rather than retry-then-fail.
_NOT_FOUND_CODES = {2, 4, 5}
_CODE_BLOCKED = 3

# HTTP status constants.
_HTTP_UNAUTHORIZED = 401
_HTTP_FORBIDDEN = 403
_HTTP_NOT_FOUND = 404
_HTTP_TOO_MANY_REQUESTS = 429
_HTTP_5XX_FLOOR = 500


class ProverkachekaClient:
    """Async HTTP client for proverkacheka.com OFD API.

    Args:
        token: API token from proverkacheka.com.
        timeout: HTTP request timeout in seconds (injected from OFD_TIMEOUT_SECONDS).
        max_attempts: Total attempts (1 = no retry); injected from OFD_RETRY_MAX_ATTEMPTS.
        http_client: Optional pre-built httpx.AsyncClient for testing with respx.
    """

    def __init__(
        self,
        *,
        token: str,
        timeout: float = 10.0,
        max_attempts: int = 3,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._token = token
        self._timeout = httpx.Timeout(timeout)
        self._max_attempts = max(1, max_attempts)
        self._client = http_client

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_receipt(
        self,
        *,
        fn: str,
        fd: str,
        fp: str,
        total_sum: int,
        purchase_date: str,
    ) -> OFDReceipt:
        """Fetch receipt data from proverkacheka.com.

        Args:
            fn: Fiscal number (ФН).
            fd: Fiscal document number (ФД) — the ``i`` field from QR.
            fp: Fiscal sign (ФП/ФПД).
            total_sum: Expected total in kopecks (for cross-validation).
            purchase_date: ISO-8601 datetime string of purchase.

        Returns:
            Parsed :class:`~src.ofd_client.schemas.OFDReceipt`.

        Raises:
            OFDNotFoundError: API returned code or HTTP 404 indicating receipt not found.
            OFDBlockedError: Unrecoverable error (bad token, permanent block, all retries).
            OFDRateLimitError: Rate limit exhausted after all retries.
        """
        # proverkacheka.com /check/get requires the full QR fields, not just
        # ids. Submitting only {fn,fd,fp,n,token} causes the server to return
        # an empty body → JSONDecodeError in the parser. We re-serialise the
        # ISO purchase_date to the QR `t=YYYYMMDDTHHMM` format and pass the
        # total sum in rubles (the API accepts kopecks → rubles via "." or
        # integer; here we use kopecks).
        check_time = purchase_date.replace("-", "").replace(":", "").rstrip("0")
        # Strip seconds: keep YYYYMMDDTHHMM (12 chars after split-T).
        if "T" in check_time:
            ymd, hms = check_time.split("T", 1)
            check_time = f"{ymd}T{hms[:4]}"
        payload = {
            "fn": fn,
            "fd": fd,
            "fp": fp,
            "t": check_time,
            "s": str(total_sum),
            "n": "1",
            "qr": "0",
            "token": self._token,
        }

        last_exc: Exception | None = None

        for attempt in range(1, self._max_attempts + 1):
            is_last = attempt == self._max_attempts
            t0 = time.monotonic()

            try:
                raw, http_status = await self._post(payload)
                duration = time.monotonic() - t0
                duration_ms = int(duration * 1000)
                logger.info(
                    "proverkacheka.response",
                    extra={
                        "provider": "proverkacheka",
                        "attempt": attempt,
                        "http_status": http_status,
                        "duration_ms": duration_ms,
                        "fn": fn,
                        "fd": fd,
                    },
                )
                ofd_request_duration_seconds.labels(provider="proverkacheka").observe(duration)
                result = self._parse_response(raw, fn=fn, fd=fd, fp=fp)
                ofd_requests_total.labels(provider="proverkacheka", status="ok").inc()
                return result

            except OFDNotFoundError:
                # Not in OFD database — no point retrying.
                ofd_requests_total.labels(provider="proverkacheka", status="not_found").inc()
                raise

            except OFDBlockedError:
                # Auth / permanent block — do not retry.
                ofd_requests_total.labels(provider="proverkacheka", status="blocked").inc()
                raise

            except _RateLimitError as exc:
                last_exc = exc
                duration_ms = int((time.monotonic() - t0) * 1000)
                retry_after = exc.retry_after
                logger.warning(
                    "proverkacheka.rate_limit",
                    extra={
                        "provider": "proverkacheka",
                        "attempt": attempt,
                        "retry_after_s": retry_after,
                        "duration_ms": duration_ms,
                        "fn": fn,
                        "fd": fd,
                    },
                )
                if is_last:
                    ofd_requests_total.labels(provider="proverkacheka", status="rate_limit").inc()
                    raise OFDRateLimitError(f"HTTP 429 after {attempt} attempt(s)") from exc
                await asyncio.sleep(retry_after if retry_after > 0 else _backoff(attempt))

            except (httpx.TimeoutException, httpx.ConnectError, _TransientError) as exc:
                last_exc = exc
                duration_ms = int((time.monotonic() - t0) * 1000)
                logger.warning(
                    "proverkacheka.transient_error",
                    extra={
                        "provider": "proverkacheka",
                        "attempt": attempt,
                        "error": str(exc)[:200],
                        "duration_ms": duration_ms,
                        "fn": fn,
                        "fd": fd,
                    },
                )
                if is_last:
                    ofd_requests_total.labels(provider="proverkacheka", status="error").inc()
                    raise OFDBlockedError(f"Upstream error after {attempt} attempt(s): {exc}") from exc
                await asyncio.sleep(_backoff(attempt))

        # Unreachable — loop always raises on last attempt.
        raise OFDBlockedError("All retries exhausted") from last_exc  # pragma: no cover

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _post(self, payload: dict) -> tuple[dict, int]:
        """Execute POST request and return (parsed JSON body, http_status_code).

        Raises:
            _RateLimitError: HTTP 429.
            _TransientError: HTTP 5xx.
            OFDBlockedError: HTTP 401 / 403.
            OFDNotFoundError: HTTP 404.
            httpx.TimeoutException: request timed out.
            httpx.ConnectError: connection-level error.
        """
        if self._client is not None:
            response = await self._client.post(
                _API_ENDPOINT,
                data=payload,
                timeout=self._timeout,
            )
        else:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    _API_ENDPOINT,
                    data=payload,
                )

        status = response.status_code

        if status == _HTTP_TOO_MANY_REQUESTS:
            retry_after_raw = response.headers.get("Retry-After", "")
            try:
                retry_after = float(retry_after_raw)
            except (ValueError, TypeError):
                retry_after = 0.0
            raise _RateLimitError(retry_after=retry_after)

        if status in (_HTTP_UNAUTHORIZED, _HTTP_FORBIDDEN):
            raise OFDBlockedError(
                f"OFD token rejected: HTTP {status}. "
                "Check PROVERKACHEKA_TOKEN in .env."
            )

        if status == _HTTP_NOT_FOUND:
            raise OFDNotFoundError("Receipt not found: HTTP 404")

        if status >= _HTTP_5XX_FLOOR:
            raise _TransientError(f"HTTP {status}")

        response.raise_for_status()
        return response.json(), status

    @staticmethod
    def _parse_response(raw: dict, *, fn: str, fd: str, fp: str) -> OFDReceipt:
        """Map proverkacheka.com JSON response to :class:`OFDReceipt`.

        Response structure (proverkacheka.com v1)::

            {
              "code": 1,
              "data": {
                "json": {
                  "fiscalDriveNumber": "...",
                  "fiscalDocumentNumber": ...,
                  "fiscalSign": ...,
                  "totalSum": ...,       # in kopecks
                  "dateTime": "YYYY-MM-DDTHH:MM:SS",
                  "user": "...",
                  "userInn": "...",
                  "retailPlaceAddress": "...",
                  "items": [
                    {"name": "...", "quantity": ..., "price": ..., "sum": ..., "nds": ...}
                  ]
                }
              }
            }

        Notes:
            - ``totalSum``, ``price``, ``sum`` are already in **kopecks**.
            - ``dateTime`` is ISO-8601 (``YYYY-MM-DDTHH:MM:SS``) — **no** timezone
              suffix; treated as Moscow time (UTC+3) in proverkacheka docs, but we
              store it as-is using ``datetime.fromisoformat`` which returns a naive
              datetime.  Callers should be aware.
            - Missing fields get safe defaults; the parser never raises on absent data.
        """
        from datetime import UTC, datetime  # noqa: PLC0415 (local import fine — tiny cost)

        code = raw.get("code")

        if code in _NOT_FOUND_CODES:
            raise OFDNotFoundError(
                f"Receipt not found in OFD (code={code}): fn={fn} fd={fd} fp={fp}"
            )
        if code == _CODE_BLOCKED:
            raise OFDBlockedError(f"OFD provider blocked request: fn={fn} fd={fd} fp={fp}")
        if code not in (_CODE_OK, None):
            # Unknown code — log + treat as not_found (safer than infinite retry).
            raise OFDNotFoundError(
                f"Unknown OFD response code={code}: fn={fn} fd={fd} fp={fp}"
            )

        data = raw.get("data", {})
        receipt_json: dict = data.get("json", {}) if isinstance(data, dict) else {}

        # Parse datetime — proverkacheka returns ISO-like: "2023-08-15T14:30:00"
        date_str = str(receipt_json.get("dateTime", ""))
        try:
            purchase_date: datetime = datetime.fromisoformat(date_str)
        except (ValueError, TypeError):
            purchase_date = datetime.now(tz=UTC)
            logger.warning(
                "proverkacheka.invalid_date",
                extra={"provider": "proverkacheka", "raw_date": date_str[:40]},
            )

        # Parse items — proverkacheka returns price/sum in kopecks.
        raw_items: list = receipt_json.get("items", []) or []
        items = [
            OFDItem(
                name=str(item.get("name", "")),
                quantity=float(item.get("quantity", 1)),
                price=int(item.get("price", 0)),
                total=int(item.get("sum", 0)),
                nds_rate=item.get("nds"),
            )
            for item in raw_items
            if isinstance(item, dict)
        ]

        return OFDReceipt(
            fn=str(receipt_json.get("fiscalDriveNumber", fn)),
            fd=str(receipt_json.get("fiscalDocumentNumber", fd)),
            fp=str(receipt_json.get("fiscalSign", fp)),
            total_sum=int(receipt_json.get("totalSum", 0)),  # already in kopecks
            purchase_date=purchase_date,
            shop_name=receipt_json.get("user"),
            shop_inn=receipt_json.get("userInn"),
            shop_address=receipt_json.get("retailPlaceAddress"),
            items=items,
            raw_response=raw,
        )


# ------------------------------------------------------------------
# Private sentinel exceptions (never leak out of this module)
# ------------------------------------------------------------------


class _RateLimitError(Exception):
    """HTTP 429 sentinel — carries the Retry-After value."""

    def __init__(self, retry_after: float = 0.0) -> None:
        super().__init__(f"HTTP 429, retry_after={retry_after}")
        self.retry_after = retry_after


class _TransientError(Exception):
    """HTTP 5xx sentinel — triggers exponential backoff."""


def _backoff(attempt: int) -> float:
    """Exponential backoff: 1 s, 2 s, 4 s, … capped at 60 s."""
    return min(2 ** (attempt - 1), 60.0)
