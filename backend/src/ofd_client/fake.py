"""FakeOFDClient — reads fixture JSON files for tests and local dev.

Fixture location: tests/fixtures/ofd_responses/{fn}_{fd}_{fp}.json
Each file must be a JSON object matching the OFDReceipt schema.

Usage in tests::

    client = FakeOFDClient(fixtures_dir=Path("tests/fixtures/ofd_responses"))
    receipt = await client.get_receipt(fn="1234", fd="5678", fp="9012", ...)
"""

from __future__ import annotations

import json
from pathlib import Path

import structlog

from src.ofd_client.exceptions import OFDNotFoundError
from src.ofd_client.schemas import OFDReceipt

logger = structlog.get_logger(__name__)

_DEFAULT_FIXTURES_DIR = Path(__file__).parent.parent.parent / "tests" / "fixtures" / "ofd_responses"


class FakeOFDClient:
    """Test double for OFDClientProtocol that reads JSON fixtures from disk."""

    def __init__(self, fixtures_dir: Path | None = None) -> None:
        self._fixtures_dir = fixtures_dir or _DEFAULT_FIXTURES_DIR

    async def get_receipt(
        self,
        *,
        fn: str,
        fd: str,
        fp: str,
        total_sum: int,
        purchase_date: str,
    ) -> OFDReceipt:
        fixture_path = self._fixtures_dir / f"{fn}_{fd}_{fp}.json"
        if not fixture_path.exists():
            logger.warning(
                "fake_ofd.fixture_not_found",
                fn=fn,
                fd=fd,
                fp=fp,
                path=str(fixture_path),
            )
            raise OFDNotFoundError(f"No fixture for fn={fn} fd={fd} fp={fp}")

        with fixture_path.open(encoding="utf-8") as fh:
            raw = json.load(fh)

        logger.debug("fake_ofd.fixture_loaded", fn=fn, fd=fd, fp=fp)
        return OFDReceipt.model_validate(raw)
