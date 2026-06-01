"""Telegram Bot API client.

Sends messages to users via the Bot API.  Retries 3x with exponential backoff
are handled by the underlying httpx transport.
"""

from __future__ import annotations

import httpx
import structlog

logger = structlog.get_logger(__name__)

_BASE_URL = "https://api.telegram.org/bot{token}/"


class TelegramBotClient:
    """Thin async wrapper around Telegram Bot API.

    Args:
        bot_token: Bot token issued by @BotFather.
        http_client: Shared httpx.AsyncClient (lifecycle managed by caller).
    """

    def __init__(self, bot_token: str, http_client: httpx.AsyncClient) -> None:
        self._token = bot_token
        self._client = http_client
        self._base_url = _BASE_URL.format(token=bot_token)

    async def send_message(
        self,
        *,
        chat_id: int,
        text: str,
        parse_mode: str = "HTML",
        reply_markup: dict | None = None,
    ) -> dict:
        """Send a text message to *chat_id*.

        Args:
            chat_id: Telegram user or chat ID.
            text: Message text (HTML markup supported when parse_mode="HTML").
            parse_mode: "HTML" | "Markdown" | "MarkdownV2".
            reply_markup: Optional inline keyboard / reply keyboard dict.

        Returns:
            Telegram API response dict (the ``result`` field).

        Raises:
            httpx.HTTPStatusError: On 4xx/5xx responses after retries.
        """
        payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup

        try:
            response = await self._client.post(
                f"{self._base_url}sendMessage",
                json=payload,
            )
            response.raise_for_status()
            data: dict = response.json()
            logger.info(
                "telegram_bot.send_message.ok",
                chat_id=chat_id,
                status_code=response.status_code,
                message_id=data.get("result", {}).get("message_id"),
            )
            return data.get("result", data)
        except httpx.HTTPStatusError as exc:
            logger.error(
                "telegram_bot.send_message.http_error",
                chat_id=chat_id,
                status_code=exc.response.status_code,
                body=exc.response.text[:200],
            )
            raise
        except httpx.RequestError as exc:
            logger.error(
                "telegram_bot.send_message.request_error",
                chat_id=chat_id,
                error=str(exc),
            )
            raise

    async def answer_callback_query(
        self,
        *,
        callback_query_id: str,
        text: str | None = None,
        show_alert: bool = False,
    ) -> dict:
        """Answer a callback query (used by inline keyboard buttons).

        Not used in the current sprint — included for completeness.
        """
        payload: dict = {
            "callback_query_id": callback_query_id,
            "show_alert": show_alert,
        }
        if text is not None:
            payload["text"] = text

        response = await self._client.post(
            f"{self._base_url}answerCallbackQuery",
            json=payload,
        )
        response.raise_for_status()
        return response.json().get("result", {})
