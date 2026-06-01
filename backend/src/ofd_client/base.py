"""OFD client protocols and factory.

Two concrete implementations:
    FakeOFDClient (tests / local dev) — reads JSON fixtures from disk.
    ProverkachekaClient (MVP production) — calls proverkacheka.com API.
    OfdRuClient (stub) — placeholder for ofd.ru / Platforma OFD integration.

Factory ``get_ofd_client()`` selects based on ``OFD_PROVIDER`` (via Settings):
    ``fake``           → FakeOFDClient  (default)
    ``proverkacheka``  → ProverkachekaClient (requires PROVERKACHEKA_TOKEN)
    ``real``           → alias for proverkacheka (convenience)
    ``ofd_ru``         → OfdRuClient stub (raises NotImplementedError — fill in later)
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from src.ofd_client.schemas import OFDReceipt


@runtime_checkable
class OFDClientProtocol(Protocol):
    """Structural protocol for OFD providers.

    All implementations must provide :meth:`get_receipt`.
    """

    async def get_receipt(
        self,
        *,
        fn: str,
        fd: str,
        fp: str,
        total_sum: int,
        purchase_date: str,
    ) -> OFDReceipt:
        """Fetch and validate receipt from the OFD provider.

        Args:
            fn: Fiscal number (ФН).
            fd: Fiscal document number (ФД).
            fp: Fiscal sign (ФП/ФПД).
            total_sum: Expected total in kopecks (for cross-validation).
            purchase_date: ISO-8601 datetime string of purchase.

        Returns:
            Parsed OFDReceipt with items and shop metadata.

        Raises:
            OFDNotFoundError: Receipt not in OFD database.
            OFDBlockedError: Provider blocked the request.
            OFDRateLimitError: Rate limit exceeded (HTTP 429).
        """
        ...


# ---------------------------------------------------------------------------
# RealOFDProvider — legacy stub; kept for backwards-compat (use ofd_ru instead)
# ---------------------------------------------------------------------------


class RealOFDProvider:
    """Legacy stub — preserved so existing code that references it still imports.

    Use ``OFD_PROVIDER=proverkacheka`` instead.  This class intentionally raises
    ``NotImplementedError`` so a misconfigured deploy fails loudly.
    """

    async def get_receipt(
        self,
        *,
        fn: str,
        fd: str,
        fp: str,
        total_sum: int,
        purchase_date: str,
    ) -> OFDReceipt:
        raise NotImplementedError(
            "RealOFDProvider is not implemented.  "
            "Use OFD_PROVIDER=proverkacheka or implement OfdRuClient."
        )


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_ofd_client(*, token: str | None = None) -> OFDClientProtocol:
    """Return the configured OFD client.

    Reads ``OFD_PROVIDER``, ``PROVERKACHEKA_TOKEN``, ``OFD_TIMEOUT_SECONDS``,
    and ``OFD_RETRY_MAX_ATTEMPTS`` from the application Settings singleton so
    that all configuration lives in one place.

    The optional ``token`` arg overrides ``PROVERKACHEKA_TOKEN`` for tests.

    Provider values:
        ``fake``           → :class:`~src.ofd_client.fake.FakeOFDClient`
        ``proverkacheka``  → :class:`~src.ofd_client.proverkacheka.ProverkachekaClient`
        ``real``           → same as ``proverkacheka``
        ``ofd_ru``         → :class:`~src.ofd_client.ofd_ru.OfdRuClient` (stub)
    """
    from src.app.depends import get_config  # noqa: PLC0415
    from src.ofd_client.fake import FakeOFDClient  # noqa: PLC0415
    from src.ofd_client.ofd_ru import OfdRuClient  # noqa: PLC0415
    from src.ofd_client.proverkacheka import ProverkachekaClient  # noqa: PLC0415

    settings = get_config()
    provider = settings.OFD_PROVIDER.lower()

    if provider in ("proverkacheka", "real"):
        effective_token = token or settings.PROVERKACHEKA_TOKEN or ""
        return ProverkachekaClient(
            token=effective_token,
            timeout=float(settings.OFD_TIMEOUT_SECONDS),
            max_attempts=int(settings.OFD_RETRY_MAX_ATTEMPTS),
        )

    if provider == "ofd_ru":
        return OfdRuClient()

    # Default: fake (safe for all test / dev environments).
    return FakeOFDClient()
