"""Money formatting for notification messages.

All monetary amounts are stored in **kopecks** (1 ₽ = 100 kopecks), matching the
frontend (``formatMoney`` divides by 100) and the API (bonus/payout amounts are
kopecks). Notification templates render these values next to the ``₽`` sign, so
they MUST be converted from kopecks to rubles first — otherwise the bot shows the
raw kopecks as if they were rubles (e.g. 25000 kopecks → "25000 ₽" instead of
"250 ₽").
"""

from __future__ import annotations

# Payload keys that carry a kopecks amount and are rendered next to ``₽``.
MONEY_PAYLOAD_KEYS = frozenset({"bonus_amount", "available", "amount", "old_amount"})


def format_kopecks(value: object) -> str:
    """Render an integer kopecks amount as a human ruble string (no ``₽`` sign).

    ``25000 → "250"``, ``25050 → "250,50"`` (Russian comma decimal). Non-integer
    input is returned unchanged so a malformed payload never crashes delivery.
    """
    try:
        kop = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return str(value)
    sign = "-" if kop < 0 else ""
    rub, rem = divmod(abs(kop), 100)
    return f"{sign}{rub}" if rem == 0 else f"{sign}{rub},{rem:02d}"


def render_money_payload(payload: dict) -> dict:
    """Return a copy of *payload* with kopecks money keys formatted as ruble strings."""
    return {k: (format_kopecks(v) if k in MONEY_PAYLOAD_KEYS else v) for k, v in payload.items()}
