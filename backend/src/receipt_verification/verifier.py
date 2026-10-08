"""OFD verifiers: ONE request per call (retries are the cron's job), every request
and response captured for the per-receipt history.

A verifier exposes ``methods`` — different ways to ask the provider about the same
receipt. Attempts rotate through them (see ``service.method_for_attempt``), so a
receipt the provider cannot match by one encoding gets a chance with another.
Adding a provider = adding a class; the schema and the cron stay as they are.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from src.ofd_client.exceptions import OFDBlockedError, OFDNotFoundError
from src.ofd_client.proverkacheka import ProverkachekaClient
from src.ofd_client.schemas import OFDItem, OFDReceipt
from src.receipt.models import VerificationOutcome
from src.receipt_intake.fiscal import FiscalData

_PROVERKACHEKA_URL = "https://proverkacheka.com/api/v1/check/get"
# proverkacheka application codes: 0 receipt invalid, 1 ok, 2 not received from ФНС yet,
# 3 request limit exceeded, 4 wait before repeating, 5 other.
_PC_CODE_OUTCOME = {
    0: VerificationOutcome.invalid,
    2: VerificationOutcome.not_found,
    3: VerificationOutcome.rate_limited,
    4: VerificationOutcome.rate_limited,
    5: VerificationOutcome.error,
}


@dataclass
class VerificationResult:
    outcome: VerificationOutcome
    request: dict
    response: dict | None = None
    http_status: int | None = None
    error: str | None = None
    duration_ms: int = 0
    receipt: OFDReceipt | None = field(default=None, repr=False)


class Verifier(Protocol):
    provider: str
    methods: tuple[str, ...]

    async def verify(self, data: FiscalData, method: str, attempt_no: int) -> VerificationResult: ...


def _t_without_seconds(t: str) -> str:
    return t[:13]


_T_WITH_SECONDS_LEN = len("YYYYMMDDTHHMMSS")


def _t_with_seconds(t: str) -> str:
    return t if len(t) == _T_WITH_SECONDS_LEN else f"{t}00"


class ProverkachekaVerifier:
    """proverkacheka.com — methods: fields (no seconds), raw QR string, fields with seconds."""

    provider = "proverkacheka"
    methods = ("fields", "qrraw", "fields_seconds")

    def __init__(self, *, token: str, timeout: float = 10.0, http_client: httpx.AsyncClient | None = None) -> None:
        self._token = token
        self._timeout = httpx.Timeout(timeout)
        self._client = http_client

    @staticmethod
    def build_request(data: FiscalData, method: str) -> dict:
        if method == "qrraw":
            return {"qrraw": data.canonical_qr}
        t = _t_with_seconds(data.t) if method == "fields_seconds" else _t_without_seconds(data.t)
        return {"fn": data.fn, "fd": data.fd, "fp": data.fp, "t": t, "s": data.sum_rub, "n": str(data.operation_type), "qr": "0"}

    async def verify(  # noqa: PLR0911 — one return per provider outcome reads clearer than a mapping
        self, data: FiscalData, method: str, attempt_no: int  # noqa: ARG002
    ) -> VerificationResult:
        request = self.build_request(data, method)
        t0 = time.monotonic()
        try:
            if self._client is not None:
                resp = await self._client.post(_PROVERKACHEKA_URL, data={**request, "token": self._token}, timeout=self._timeout)
            else:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    resp = await client.post(_PROVERKACHEKA_URL, data={**request, "token": self._token})
        except httpx.HTTPError as exc:
            return VerificationResult(
                VerificationOutcome.error, request, error=f"{type(exc).__name__}: {exc}"[:500], duration_ms=_ms(t0)
            )
        duration = _ms(t0)
        if resp.status_code in (401, 403):
            return VerificationResult(VerificationOutcome.blocked, request, http_status=resp.status_code,
                                      error="token rejected", duration_ms=duration)
        if resp.status_code == 429:  # noqa: PLR2004
            return VerificationResult(VerificationOutcome.rate_limited, request, http_status=429, duration_ms=duration)
        try:
            body = resp.json()
        except ValueError:
            return VerificationResult(VerificationOutcome.error, request, http_status=resp.status_code,
                                      error=f"non-JSON body: {resp.text[:200]}", duration_ms=duration)
        if resp.status_code >= 400 or not isinstance(body, dict):  # noqa: PLR2004
            return VerificationResult(VerificationOutcome.error, request, response=_as_dict(body),
                                      http_status=resp.status_code, duration_ms=duration)
        code = body.get("code")
        if code != 1:
            outcome = _PC_CODE_OUTCOME.get(code, VerificationOutcome.error)
            return VerificationResult(outcome, request, response=body, http_status=resp.status_code,
                                      error=str(body.get("data"))[:500] if body.get("data") else None, duration_ms=duration)
        try:
            receipt = ProverkachekaClient._parse_response(body, fn=data.fn, fd=data.fd, fp=data.fp)  # noqa: SLF001
        except (OFDNotFoundError, OFDBlockedError, ValueError, TypeError) as exc:
            return VerificationResult(VerificationOutcome.error, request, response=body, http_status=resp.status_code,
                                      error=f"unparseable answer: {exc}"[:500], duration_ms=duration)
        return VerificationResult(VerificationOutcome.ok, request, response=body, http_status=resp.status_code,
                                  duration_ms=duration, receipt=receipt)


class FakeVerifier:
    """Deterministic stand-in for stage/dev (``OFD_PROVIDER=fake``) — no network.

    Rules, so every branch can be demonstrated on the stand:
    - ФН starting with ``9999`` → never found (ends as ``failed`` after all retries);
    - ФП ending with ``0`` → not found on the first 2 attempts, found from the 3rd (retry path);
    - otherwise → found immediately, with one synthetic line item for the full sum.
    """

    provider = "fake"
    methods = ("fields", "qrraw", "fields_seconds")

    async def verify(self, data: FiscalData, method: str, attempt_no: int) -> VerificationResult:
        request = ProverkachekaVerifier.build_request(data, method)
        if data.fn.startswith("9999"):
            return VerificationResult(VerificationOutcome.not_found, request, response={"code": 2, "data": "fake: never"})
        if data.fp.endswith("0") and attempt_no < 3:  # noqa: PLR2004
            return VerificationResult(VerificationOutcome.not_found, request, response={"code": 2, "data": "fake: not yet"})
        receipt = OFDReceipt(
            fn=data.fn, fd=data.fd, fp=data.fp, total_sum=data.total_sum_kop, purchase_date=data.purchase_at,
            shop_name="ООО «Демо-магазин»", shop_inn="7700000000", shop_address="г. Москва, тестовая ул., 1",
            items=[OFDItem(name="SWONQ L18000 (демо)", quantity=1, price=data.total_sum_kop, total=data.total_sum_kop)],
        )
        body = {"code": 1, "data": {"json": {"user": receipt.shop_name, "userInn": receipt.shop_inn,
                                             "totalSum": data.total_sum_kop, "fake": True}}}
        return VerificationResult(VerificationOutcome.ok, request, response=body, http_status=200, receipt=receipt)

def _ms(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)


def _as_dict(body: object) -> dict:
    return body if isinstance(body, dict) else {"body": body}


def get_verifier(*, provider: str, token: str | None, timeout: float = 10.0) -> Verifier:
    if provider == "proverkacheka":
        if not token:
            raise RuntimeError("PROVERKACHEKA_TOKEN must be set when OFD_PROVIDER=proverkacheka")
        return ProverkachekaVerifier(token=token, timeout=timeout)
    return FakeVerifier()
