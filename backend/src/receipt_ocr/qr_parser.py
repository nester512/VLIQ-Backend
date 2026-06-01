"""Parser for Russian fiscal QR code strings.

Russian federal tax service QR format (per ФЗ-54):
    t=<YYYYMMDDTHHMM>&s=<sum.kop>&fn=<fn>&i=<fd>&fp=<fp>&n=<op_type>

    t  — purchase datetime (YYYYMMDDTHHmm or YYYYMMDDTHHmmss)
    s  — total sum with dot separator (e.g. 599.00 → 59900 kopecks)
    fn — fiscal number (ФН)
    i  — fiscal document number (ФД)
    fp — fiscal sign (ФП/ФПД)
    n  — operation type: 1=receipt, 2=correction_receipt, 3=refund, 4=correction_refund
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from urllib.parse import parse_qs


class QRParseError(ValueError):
    """Raised when the QR string cannot be parsed into a valid ParsedQR."""


@dataclass
class ParsedQR:
    """Structured fields extracted from a Russian fiscal QR code."""

    fn: str
    fd: str  # fiscal document number — query param 'i'
    fp: str
    total_sum_kop: int  # total sum in kopecks
    purchase_date: datetime  # timezone-aware UTC
    operation_type: int  # 1=receipt, 2=correction, 3=refund, 4=correction_refund


_REQUIRED_KEYS = ("fn", "i", "fp", "s", "t")

# Supported datetime formats from the QR.
_DATE_FORMATS = (
    "%Y%m%dT%H%M%S",
    "%Y%m%dT%H%M",
    "%Y%m%dT%H%M%S%z",
)


def parse_qr_string(raw: str) -> ParsedQR:
    """Parse *raw* fiscal QR string into :class:`ParsedQR`.

    Args:
        raw: Raw QR string, e.g.
            ``t=20260524T1430&s=12345.67&fn=1234567890&i=12345&fp=67890&n=1``

    Returns:
        :class:`ParsedQR` with all fields populated.

    Raises:
        QRParseError: Missing required key, wrong format, or invalid numeric value.
    """
    # Strip leading/trailing whitespace and common URL prefix.
    raw = raw.strip()
    if raw.startswith("https://"):
        # Some scanners return a full proverkacheka URL — strip the host part.
        qm = raw.find("?")
        if qm != -1:
            raw = raw[qm + 1 :]
        else:
            raise QRParseError(f"QR string looks like URL but has no query string: {raw[:80]!r}")

    params = parse_qs(raw, keep_blank_values=False)
    # parse_qs returns lists; flatten to first value.
    flat: dict[str, str] = {k: v[0] for k, v in params.items() if v}

    missing = [k for k in _REQUIRED_KEYS if k not in flat]
    if missing:
        raise QRParseError(f"QR string is missing required keys: {missing} (raw={raw[:120]!r})")

    # Parse sum → kopecks.
    try:
        total_sum_kop = _parse_sum(flat["s"])
    except ValueError as exc:
        raise QRParseError("Invalid sum value {!r}: {}".format(flat["s"], exc)) from exc

    # Parse purchase date.
    try:
        purchase_date = _parse_date(flat["t"])
    except ValueError as exc:
        raise QRParseError("Invalid date value {!r}: {}".format(flat["t"], exc)) from exc

    # Parse operation type (optional, default=1).
    try:
        operation_type = int(flat.get("n", "1"))
    except ValueError as exc:
        raise QRParseError("Invalid operation_type value {!r}: {}".format(flat.get("n"), exc)) from exc

    return ParsedQR(
        fn=flat["fn"],
        fd=flat["i"],
        fp=flat["fp"],
        total_sum_kop=total_sum_kop,
        purchase_date=purchase_date,
        operation_type=operation_type,
    )


def _parse_sum(s: str) -> int:
    """Convert QR sum string to integer kopecks.

    Examples:
        '599.00' → 59900
        '1234.5' → 123450
        '100'    → 10000
    """
    s = s.strip().replace(",", ".")
    if "." in s:
        roubles, _, kopecks_str = s.partition(".")
        # Pad or truncate to 2 decimal places.
        kopecks_str = (kopecks_str + "00")[:2]
        return int(roubles) * 100 + int(kopecks_str)
    return int(s) * 100


def _parse_date(t: str) -> datetime:
    """Parse fiscal QR datetime string into timezone-aware UTC datetime."""
    t = t.strip()
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(t, fmt)
            if dt.tzinfo is None:
                # Russian fiscal QR has no timezone — assume Moscow time (UTC+3).
                moscow_tz = timezone(timedelta(hours=3))
                dt = dt.replace(tzinfo=moscow_tz)
            return dt.astimezone(UTC)
        except ValueError:
            continue

    raise ValueError(f"Cannot parse date {t!r} with any known format")
