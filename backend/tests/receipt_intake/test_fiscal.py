"""Fiscal QR validation — the SAME case table runs in frontend/src/features/seller/qr/fiscalQr.test.ts.

Keep both tables identical: the device rejects bad scans before any request, the
API re-checks; a drift would let the server refuse what the device accepted.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from src.receipt_intake.fiscal import FiscalValidationError, parse_qr, validate_fields

NOW = datetime(2026, 10, 8, 12, 0, tzinfo=UTC)  # 15:00 MSK
FN = "9960440300712345"

VALID_QR = [
    # raw, expected (t, sum_kop, fd, fp)
    (f"t=20261008T1432&s=1450.00&fn={FN}&i=12345&fp=3826178549&n=1", ("20261008T1432", 145000, "12345", "3826178549")),
    (f"t=20261008T143205&s=99.9&fn={FN}&i=7&fp=1&n=1", ("20261008T143205", 9990, "7", "1")),
    (f"t=20261001T0900&s=100&fn={FN}&i=1&fp=2", ("20261001T0900", 10000, "1", "2")),  # n omitted → 1
    (f"https://check.ofd.ru/rec?t=20261008T1000&s=5.00&fn={FN}&i=3&fp=4&n=1", ("20261008T1000", 500, "3", "4")),
    (f"fn={FN}&fp=4&i=3&n=1&s=12,50&t=20261008T1000", ("20261008T1000", 1250, "3", "4")),  # any order, comma
    (f"t=20261008T1000&s=1&fn={FN}&i=00012&fp=0003826178549", ("20261008T1000", 100, "12", "3826178549")),  # padded
]

INVALID_QR = [
    ("https://vliq.ru/promo", "QR_NOT_FISCAL"),
    ("hello", "QR_NOT_FISCAL"),
    ("t=20261008T1432&s=1450.00&fn=123&i=1&fp=1&n=1", "QR_FN_INVALID"),
    (f"t=20261008T1432&s=1450.00&fn={FN}&i=0&fp=1&n=1", "QR_FD_INVALID"),
    (f"t=20261008T1432&s=1450.00&fn={FN}&i=12345678901&fp=1&n=1", "QR_FD_INVALID"),
    (f"t=20261008T1432&s=1450.00&fn={FN}&i=1&fp=abc&n=1", "QR_FP_INVALID"),
    (f"t=2026-10-08&s=1450.00&fn={FN}&i=1&fp=1&n=1", "QR_DATE_INVALID"),
    (f"t=20261332T1432&s=1450.00&fn={FN}&i=1&fp=1&n=1", "QR_DATE_INVALID"),
    (f"t=20261012T1432&s=1450.00&fn={FN}&i=1&fp=1&n=1", "QR_DATE_IN_FUTURE"),
    (f"t=20261008T1432&s=0.00&fn={FN}&i=1&fp=1&n=1", "QR_SUM_INVALID"),
    (f"t=20261008T1432&s=12.345&fn={FN}&i=1&fp=1&n=1", "QR_SUM_INVALID"),
    (f"t=20261008T1432&s=1450.00&fn={FN}&i=1&fp=1&n=2", "QR_NOT_INCOME"),
    (f"t=20261008T1432&s=1450.00&fn={FN}&i=1&fp=1&n=x", "QR_OPERATION_INVALID"),
    ("t=20261008T1432&s=1&fn=\u0669\u0669\u0666\u0660\u0664\u0664\u0660\u0663\u0660\u0660\u0667\u0661\u0662\u0663\u0664\u0665&i=1&fp=1", "QR_FN_INVALID"),  # Arabic-Indic digits
]


@pytest.mark.parametrize(("raw", "expected"), VALID_QR)
def test_valid_qr(raw: str, expected: tuple) -> None:
    data = parse_qr(raw, now=NOW)
    assert (data.t, data.total_sum_kop, data.fd, data.fp) == expected
    assert data.fn == FN
    assert data.operation_type == 1


@pytest.mark.parametrize(("raw", "code"), INVALID_QR)
def test_invalid_qr(raw: str, code: str) -> None:
    with pytest.raises(FiscalValidationError) as exc:
        parse_qr(raw, now=NOW)
    assert exc.value.code == code


def test_canonical_qr_round_trips() -> None:
    data = parse_qr(f"fn={FN}&fp=4&i=3&n=1&s=12,5&t=20261008T1000", now=NOW)
    assert data.canonical_qr == f"t=20261008T1000&s=12.50&fn={FN}&i=3&fp=4&n=1"
    assert parse_qr(data.canonical_qr, now=NOW) == data


def test_qr_time_is_moscow_and_stored_utc() -> None:
    data = parse_qr(f"t=20261008T1432&s=1&fn={FN}&i=1&fp=1", now=NOW)
    assert data.purchase_at == datetime(2026, 10, 8, 11, 32, tzinfo=UTC)


def test_east_of_moscow_shop_is_not_in_the_future() -> None:
    # QR time is read as MSK; a shop east of Moscow prints a «later» time —
    # up to 14 h ahead of now is accepted, not rejected as «in the future».
    validate_fields(fn=FN, fd="1", fp="1", t="20261008T2359", s="1", now=NOW)


def test_manual_fields_tolerate_spaces_in_numbers() -> None:
    data = validate_fields(fn="9960 4403 0071 2345", fd=" 12 ", fp="38261 78549", t="20261008T1432", s="1450", now=NOW)
    assert (data.fn, data.fd, data.fp) == (FN, "12", "3826178549")


def test_purchase_date_is_the_moscow_calendar_day() -> None:
    data = validate_fields(fn=FN, fd="1", fp="1", t="20261008T0130", s="1", now=NOW)
    assert data.purchase_at.date().isoformat() == "2026-10-07"  # UTC
    assert data.purchase_date.isoformat() == "2026-10-08"  # what we store


def test_too_old_is_valid_but_flagged() -> None:
    data = validate_fields(fn=FN, fd="1", fp="1", t="20260801T1000", s="1")
    assert data.is_too_old  # not an error: BRD keeps old receipts as an admin signal
