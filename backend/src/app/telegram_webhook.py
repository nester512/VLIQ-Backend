"""Telegram Bot webhook handler.

Receives Telegram Updates posted by Telegram servers and dispatches
simple command handling.  Currently handles:

  /start → sends a welcome message with a Mini App launch button.

Register the webhook URL with Telegram once after deploying:

    curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \\
      -d "url=https://<ngrok-host>/api/v1/webhook/telegram"
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Telegram Webhook"])

# URL of the Telegram Mini App frontend. Read from the TMA_URL env var so it
# stays in sync with the bot (src/bot/__main__.py); falls back to the public link.
_TMA_URL = os.environ.get("TMA_URL", "https://t.me/vliq_bot/app")

_WELCOME_TEXT = (
    "👋 Добро пожаловать в VLIQ!\n\n"
    "Загружайте чеки, получайте бонусы и выводите на карту.\n"
    "Нажмите кнопку ниже, чтобы открыть приложение."
)


@router.post(
    "/webhook/telegram",
    status_code=status.HTTP_200_OK,
    summary="Telegram Bot webhook (internal)",
    description="Receives Telegram Updates. Must be registered via setWebhook.",
    include_in_schema=False,
)
async def telegram_webhook(request: Request) -> JSONResponse:
    """Process an incoming Telegram Update.

    Always returns 200 OK so Telegram does not retry the delivery.
    """
    try:
        update: dict[str, Any] = await request.json()
    except Exception:
        # Malformed JSON — still return 200 to avoid Telegram retries.
        return JSONResponse(content={"ok": True})

    bot = getattr(request.app.state, "bot", None)
    if bot is None:
        logger.warning("telegram_webhook.no_bot_client")
        return JSONResponse(content={"ok": True})

    message: dict[str, Any] | None = update.get("message")
    if message is None:
        return JSONResponse(content={"ok": True})

    chat_id: int | None = message.get("chat", {}).get("id")
    text: str = message.get("text", "")

    if chat_id is None:
        return JSONResponse(content={"ok": True})

    if text.strip().startswith("/start"):
        reply_markup = {
            "inline_keyboard": [
                [
                    {
                        "text": "Открыть VLIQ",
                        "web_app": {"url": _TMA_URL},
                    }
                ]
            ]
        }
        try:
            await bot.send_message(
                chat_id=chat_id,
                text=_WELCOME_TEXT,
                parse_mode="HTML",
                reply_markup=reply_markup,
            )
        except Exception as exc:
            logger.warning("telegram_webhook.send_start_failed chat_id=%s: %s", chat_id, exc)

    return JSONResponse(content={"ok": True})
