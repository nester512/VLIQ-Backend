"""Unit tests for FakeOFDClient."""

from __future__ import annotations

from pathlib import Path

import pytest
from src.ofd_client.exceptions import OFDNotFoundError
from src.ofd_client.fake import FakeOFDClient
from src.ofd_client.schemas import OFDReceipt

# Path to the fixtures shipped with the test suite.
FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "ofd_responses"

# The sample fixture is: tests/fixtures/ofd_responses/1234567890_12345_67890.json
FIXTURE_FN = "1234567890"
FIXTURE_FD = "12345"
FIXTURE_FP = "67890"


@pytest.fixture
def fake_client() -> FakeOFDClient:
    return FakeOFDClient(fixtures_dir=FIXTURES_DIR)


@pytest.mark.asyncio
async def test_fake_ofd_client__existing_fixture__returns_ofd_receipt(fake_client: FakeOFDClient):
    """FakeOFDClient loads the JSON fixture and returns a valid OFDReceipt."""
    receipt = await fake_client.get_receipt(
        fn=FIXTURE_FN,
        fd=FIXTURE_FD,
        fp=FIXTURE_FP,
        total_sum=59900,
        purchase_date="2026-05-01T14:30:00+03:00",
    )
    assert isinstance(receipt, OFDReceipt)
    assert receipt.fn == FIXTURE_FN
    assert receipt.fd == FIXTURE_FD
    assert receipt.fp == FIXTURE_FP
    assert receipt.total_sum == 59900
    assert len(receipt.items) == 1
    assert receipt.items[0].name == "Тестовый товар"


@pytest.mark.asyncio
async def test_fake_ofd_client__missing_fixture__raises_ofd_not_found(fake_client: FakeOFDClient):
    """FakeOFDClient raises OFDNotFoundError when no matching fixture file exists."""
    with pytest.raises(OFDNotFoundError, match="fn=9999"):
        await fake_client.get_receipt(
            fn="9999",
            fd="0000",
            fp="1111",
            total_sum=100,
            purchase_date="2026-01-01T00:00:00+00:00",
        )


@pytest.mark.asyncio
async def test_fake_ofd_client__default_fixtures_dir__resolves(tmp_path: Path):
    """FakeOFDClient with no fixtures_dir arg uses the default path."""
    client = FakeOFDClient()
    # Default dir may or may not have fixtures — just verify no error on construction.
    assert client._fixtures_dir is not None
