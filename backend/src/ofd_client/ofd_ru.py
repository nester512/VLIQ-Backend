"""OfdRuClient — stub adapter for ofd.ru / Platforma OFD.

TODO: implement when migrating from proverkacheka.com to a commercial OFD operator.

Docs:
    https://platformaofd.ru/developers/  — Platforma OFD (ПАО "Платформа ОФД")
    https://ofd.ru/api                   — OFD.ru API docs (requires B2B contract)

Steps to implement:
    1. Sign B2B contract with Platforma OFD or OFD.ru.
    2. Obtain API credentials (client_id + client_secret or API key).
    3. Implement ``get_receipt`` using ``httpx.AsyncClient``, mapping the
       provider JSON to ``OFDReceipt`` (see ``ProverkachekaClient._parse_response``
       for the pattern).
    4. Set ``OFD_PROVIDER=ofd_ru`` and the relevant credential env vars in ``.env``.
    5. Register the credentials in ``src/app/settings.py``.
"""

from __future__ import annotations

from src.ofd_client.schemas import OFDReceipt


class OfdRuClient:
    """Stub OFD client for ofd.ru / Platforma OFD.

    This class satisfies ``OFDClientProtocol`` structurally but raises
    ``NotImplementedError`` on every call.  A misconfigured deploy will fail
    loudly instead of silently returning fake data.
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
            "OfdRuClient is not yet implemented.  "
            "See src/ofd_client/ofd_ru.py for the implementation TODO list, "
            "or use OFD_PROVIDER=proverkacheka for the working provider."
        )
