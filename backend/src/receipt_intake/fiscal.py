"""Strict validation of fiscal receipt data (the contents of a ФНС receipt QR).

The seller's device scans / decodes / types the data and validates it with the
mirror of these rules (``frontend/src/features/seller/qr/fiscalQr.ts``); the API
re-validates because the client is never trusted. Both test suites run the same
case table (``tests/receipt_intake/test_fiscal.py`` ↔ ``fiscalQr.test.ts``) so the
rules cannot drift apart.

QR format (ФЗ-54): ``t=YYYYMMDDTHHMM[SS]&s=<rub>[.kop]&fn=<ФН>&i=<ФД>&fp=<ФП>&n=<тип>``.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone

# ФН — 16 digits; ФД / ФП — up to 10 digits (ФП is a 32-bit number).
# re.ASCII: `\d` must not accept Arabic-Indic & co. digits (int() would happily parse them).
_FN_RE = re.compile(r"^\d{16}$", re.ASCII)
_FD_RE = re.compile(r"^\d{1,10}$", re.ASCII)
_FP_RE = re.compile(r"^\d{1,10}$", re.ASCII)
_T_RE = re.compile(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$", re.ASCII)
_S_RE = re.compile(r"^\d{1,9}([.,]\d{1,2})?$", re.ASCII)

OPERATION_INCOME = 1  # «приход» — the only type that earns a bonus (2 = возврат прихода, …)
MAX_AGE_DAYS = 30
# QR time has no zone; we read it as Moscow time. Shops east of Moscow are up to
# +9 h ahead, so «in the future» is only an error beyond this tolerance.
_FUTURE_TOLERANCE = timedelta(hours=14)
_MSK = timezone(timedelta(hours=3))


class FiscalValidationError(ValueError):
    """Invalid fiscal data. ``code`` is a stable machine code, ``field`` the culprit."""

    def __init__(self, code: str, field: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.field = field
        self.message = message


@dataclass(frozen=True)
class FiscalData:
    fn: str
    fd: str
    fp: str
    t: str  # as in the QR: YYYYMMDDTHHMM or YYYYMMDDTHHMMSS
    total_sum_kop: int
    operation_type: int
    purchase_at: datetime  # UTC

    @property
    def purchase_date(self) -> date:
        """Calendar date of the purchase in Moscow time (a 01:30 MSK receipt is that day, not the UTC day before)."""
        return self.purchase_at.astimezone(_MSK).date()

    @property
    def sum_rub(self) -> str:
        return f"{self.total_sum_kop // 100}.{self.total_sum_kop % 100:02d}"

    @property
    def canonical_qr(self) -> str:
        """The QR string in canonical field order — what we store as ``qr_raw``."""
        return f"t={self.t}&s={self.sum_rub}&fn={self.fn}&i={self.fd}&fp={self.fp}&n={self.operation_type}"

    @property
    def is_too_old(self) -> bool:
        return datetime.now(UTC) - self.purchase_at > timedelta(days=MAX_AGE_DAYS)


def _digits(value: str | int | None) -> str:
    return re.sub(r"\s+", "", str(value or ""))


def _number(value: str | int | None) -> str:
    """ФД / ФП as a number: no spaces, no leading zeros (a paper receipt may pad them),
    so «00012» and «12» are the same receipt for duplicate detection and the OFD."""
    s = _digits(value)
    return s.lstrip("0") or s


def validate_fields(  # noqa: PLR0913
    *, fn: str | int, fd: str | int, fp: str | int, t: str, s: str | int | float, n: str | int = OPERATION_INCOME,
    now: datetime | None = None,
) -> FiscalData:
    """Validate the six QR fields and normalise them. Raises :class:`FiscalValidationError`."""
    fn_s, fd_s, fp_s = _digits(fn), _number(fd), _number(fp)
    if not _FN_RE.match(fn_s):
        raise FiscalValidationError("QR_FN_INVALID", "fn", "ФН — ровно 16 цифр")
    if not _FD_RE.match(fd_s) or int(fd_s) == 0:
        raise FiscalValidationError("QR_FD_INVALID", "fd", "ФД — число до 10 цифр")
    if not _FP_RE.match(fp_s) or int(fp_s) == 0:
        raise FiscalValidationError("QR_FP_INVALID", "fp", "ФП — число до 10 цифр")

    t_s = str(t).strip()
    m = _T_RE.match(t_s)
    if not m:
        raise FiscalValidationError("QR_DATE_INVALID", "t", "Дата и время чека в формате ГГГГММДДTЧЧММ")
    year, month, day, hour, minute, second = (int(x) if x else 0 for x in m.groups())
    try:
        local = datetime(year, month, day, hour, minute, second, tzinfo=_MSK)
    except ValueError as exc:
        raise FiscalValidationError("QR_DATE_INVALID", "t", "Такой даты не существует") from exc
    purchase_at = local.astimezone(UTC)
    if purchase_at - (now or datetime.now(UTC)) > _FUTURE_TOLERANCE:
        raise FiscalValidationError("QR_DATE_IN_FUTURE", "t", "Дата чека в будущем")

    s_s = str(s).strip()
    if not _S_RE.match(s_s):
        raise FiscalValidationError("QR_SUM_INVALID", "s", "Сумма — число с копейками через точку")
    rub, _, kop = s_s.replace(",", ".").partition(".")
    total = int(rub) * 100 + int((kop + "00")[:2])
    if total <= 0:
        raise FiscalValidationError("QR_SUM_INVALID", "s", "Сумма должна быть больше нуля")

    try:
        op = int(str(n).strip())
    except ValueError as exc:
        raise FiscalValidationError("QR_OPERATION_INVALID", "n", "Неизвестный тип операции") from exc
    if op != OPERATION_INCOME:
        raise FiscalValidationError("QR_NOT_INCOME", "n", "Это не чек продажи (возврат или коррекция)")

    return FiscalData(
        fn=fn_s, fd=fd_s, fp=fp_s, t=t_s, total_sum_kop=total, operation_type=op, purchase_at=purchase_at
    )


def parse_qr(raw: str, *, now: datetime | None = None) -> FiscalData:
    """Parse + validate a raw QR string (``t=…&s=…`` or a URL with that query)."""
    from urllib.parse import parse_qs  # noqa: PLC0415

    text = (raw or "").strip()
    if "?" in text and text.lower().startswith(("http://", "https://")):
        text = text.split("?", 1)[1]
    params = {k: v[0] for k, v in parse_qs(text, keep_blank_values=False).items() if v}
    missing = [k for k in ("t", "s", "fn", "i", "fp") if k not in params]
    if missing:
        raise FiscalValidationError("QR_NOT_FISCAL", "qr", "Это не QR-код кассового чека")
    return validate_fields(
        fn=params["fn"], fd=params["i"], fp=params["fp"], t=params["t"], s=params["s"], n=params.get("n", "1"), now=now
    )
