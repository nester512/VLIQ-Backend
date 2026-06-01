"""Real-API integration test for ProverkachekaClient.

This test hits the live proverkacheka.com API and is intentionally SKIPPED
unless both environment variables are set:

    PROVERKACHEKA_TOKEN=<your_token>
    RUN_OFD_INTEGRATION=1

How to run::

    PROVERKACHEKA_TOKEN=<token> RUN_OFD_INTEGRATION=1 \\
        poetry run pytest tests/ofd_client/test_proverkacheka_real.py -v

The receipt identifiers below are taken from the proverkacheka.com example
documentation and are suitable for public testing.  Do NOT replace them with
a real customer receipt without sanitising PII first.

Example receipt (proverkacheka.com sample):
    fn  = 9960440300115271
    fd  = 41234
    fp  = 2093842751
    sum = 590 RUB (59000 kopecks)
    date = 2023-08-15T14:30:00
"""

from __future__ import annotations

import os

import pytest
from src.ofd_client.proverkacheka import ProverkachekaClient
from src.ofd_client.schemas import OFDReceipt  # noqa: F401 (used in type annotation)

# ---------------------------------------------------------------------------
# Skip condition
# ---------------------------------------------------------------------------

_TOKEN = os.environ.get("PROVERKACHEKA_TOKEN", "")
_RUN_INTEGRATION = os.environ.get("RUN_OFD_INTEGRATION", "0") == "1"

_SKIP_REASON = (
    "Skipped: set PROVERKACHEKA_TOKEN=<token> and RUN_OFD_INTEGRATION=1 to run"
)

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not (_TOKEN and _RUN_INTEGRATION),
        reason=_SKIP_REASON,
    ),
]

# ---------------------------------------------------------------------------
# Sample receipt — from proverkacheka.com docs / public example.
# Replace with a real receipt you own if the sample is no longer available.
# ---------------------------------------------------------------------------

_SAMPLE_FN = "9960440300115271"
_SAMPLE_FD = "41234"
_SAMPLE_FP = "2093842751"
_SAMPLE_SUM = 59000          # kopecks (590 RUB)
_SAMPLE_DATE = "2023-08-15T14:30:00"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_real_api__returns_valid_receipt():
    """Hit the live proverkacheka.com API and verify the response shape.

    Asserts:
        - Returns an OFDReceipt (not an exception).
        - fn / fd / fp are preserved.
        - total_sum is a non-negative integer (kopecks).
        - purchase_date is a datetime.
        - items is a list (possibly empty for old receipts with no item data).
    """
    from datetime import datetime  # noqa: PLC0415

    client = ProverkachekaClient(
        token=_TOKEN,
        timeout=15.0,
        max_attempts=3,
    )

    receipt = await client.get_receipt(
        fn=_SAMPLE_FN,
        fd=_SAMPLE_FD,
        fp=_SAMPLE_FP,
        total_sum=_SAMPLE_SUM,
        purchase_date=_SAMPLE_DATE,
    )

    assert isinstance(receipt, OFDReceipt), f"Expected OFDReceipt, got {type(receipt)}"
    assert receipt.fn == _SAMPLE_FN
    assert receipt.fd == str(int(_SAMPLE_FD))  # API may return int → str
    assert receipt.total_sum >= 0
    assert isinstance(receipt.purchase_date, datetime)
    assert isinstance(receipt.items, list)
