"""VLIQ Telegram Bot entry point.

Minimal aiogram 3 bot supporting two runtime modes:
    - polling  (default, dev-friendly, no HTTPS required)
    - webhook  (production-grade, requires HTTPS + Caddy reverse proxy)

Environment variables:
    TG_BOT_TOKEN         — Telegram bot token (required).
    TMA_URL              — URL of the Telegram Mini App (optional).
    BOT_MODE             — "polling" (default) | "webhook".
    BOT_WEBHOOK_HOST     — Public hostname for webhook URL (required in webhook mode).
    BOT_WEBHOOK_SECRET   — Secret token placed in the URL path (required in webhook mode).
    BOT_WEBHOOK_PORT     — Internal port the aiohttp server listens on (default 8081).
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal

from aiogram import Bot, Dispatcher
from aiogram.enums import ParseMode
from aiogram.filters import Command
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TG_BOT_TOKEN: str = os.environ.get("TG_BOT_TOKEN", "")
TMA_URL: str = os.environ.get("TMA_URL", "https://t.me/vliq_bot/app")

BOT_MODE: str = os.environ.get("BOT_MODE", "polling").lower()
BOT_WEBHOOK_HOST: str = os.environ.get("BOT_WEBHOOK_HOST", "")
BOT_WEBHOOK_SECRET: str = os.environ.get("BOT_WEBHOOK_SECRET", "")
BOT_WEBHOOK_PORT: int = int(os.environ.get("BOT_WEBHOOK_PORT", "8081"))

_HELP_TEXT = (
    "<b>VLIQ — программа мотивации продавцов</b>\n\n"
    "Что умеет это приложение:\n"
    "• Загружай чеки о продажах — получай бонусы\n"
    "• Отслеживай статус каждого чека в реальном времени\n"
    "• Запрашивай выплату накопленных бонусов\n"
    "• Смотри историю транзакций и уведомления\n\n"
    "Для начала работы нажми /start и открой мини-приложение."
)


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def cmd_start(message: Message) -> None:
    """Send welcome message with an inline WebApp button."""
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="Открыть VLIQ",
                    web_app=WebAppInfo(url=TMA_URL),
                )
            ]
        ]
    )
    await message.answer(
        "Привет! Я бот программы лояльности <b>VLIQ</b>.\n\n"
        "Открой мини-приложение, чтобы загружать чеки, получать бонусы и запрашивать выплаты.",
        parse_mode=ParseMode.HTML,
        reply_markup=keyboard,
    )


async def cmd_help(message: Message) -> None:
    """Describe the app."""
    await message.answer(_HELP_TEXT, parse_mode=ParseMode.HTML)


# ---------------------------------------------------------------------------
# Handler registration helper
# ---------------------------------------------------------------------------


def register_handlers(dp: Dispatcher) -> None:
    """Bind all bot command handlers to the dispatcher.

    Extracted so tests and both startup paths can register handlers
    without duplicating the list.
    """
    dp.message.register(cmd_start, Command("start"))
    dp.message.register(cmd_help, Command("help"))


# ---------------------------------------------------------------------------
# Webhook startup helper
# ---------------------------------------------------------------------------


def _build_webhook_url() -> str:
    """Assemble the public webhook URL from environment variables."""
    return f"https://{BOT_WEBHOOK_HOST}/tg-webhook/{BOT_WEBHOOK_SECRET}"


def build_webhook_app(bot: Bot, dp: Dispatcher) -> aiohttp.web.Application:  # noqa: F821
    """Create and configure the aiohttp web application for webhook mode.

    The aiogram SimpleRequestHandler verifies the ``X-Telegram-Bot-Api-Secret-Token``
    header so requests without the correct secret are rejected before dispatch.
    """
    from aiogram.webhook.aiohttp_server import SimpleRequestHandler, setup_application
    from aiohttp import web

    app = web.Application()
    webhook_path = f"/tg-webhook/{BOT_WEBHOOK_SECRET}"
    SimpleRequestHandler(dispatcher=dp, bot=bot, secret_token=BOT_WEBHOOK_SECRET).register(
        app, path=webhook_path
    )
    setup_application(app, dp, bot=bot)
    return app


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main() -> None:
    if not TG_BOT_TOKEN:
        raise RuntimeError("TG_BOT_TOKEN environment variable is not set")

    bot = Bot(token=TG_BOT_TOKEN)
    dp = Dispatcher()
    register_handlers(dp)

    if BOT_MODE == "webhook":
        _run_webhook(bot, dp)
    else:
        logger.info("Starting VLIQ bot (long polling)…")
        await dp.start_polling(bot)


def _run_webhook(bot: Bot, dp: Dispatcher) -> None:
    """Start the aiohttp webhook server (sync entry point for aiohttp.web.run_app)."""
    import asyncio

    from aiohttp import web

    if not BOT_WEBHOOK_HOST:
        raise RuntimeError("BOT_WEBHOOK_HOST must be set when BOT_MODE=webhook")
    if not BOT_WEBHOOK_SECRET:
        raise RuntimeError("BOT_WEBHOOK_SECRET must be set when BOT_MODE=webhook")

    webhook_url = _build_webhook_url()
    app = build_webhook_app(bot, dp)

    async def on_startup(_app: web.Application) -> None:
        logger.info("Registering webhook: %s", webhook_url)
        await bot.set_webhook(
            url=webhook_url,
            secret_token=BOT_WEBHOOK_SECRET,
            drop_pending_updates=True,
        )
        logger.info("Webhook registered. Listening on 0.0.0.0:%d", BOT_WEBHOOK_PORT)

    async def on_shutdown(_app: web.Application) -> None:
        logger.info("Removing webhook (graceful shutdown)…")
        await bot.delete_webhook(drop_pending_updates=False)
        await bot.session.close()

    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    # Handle SIGTERM so docker stop / k8s eviction triggers on_shutdown properly.
    loop = asyncio.get_event_loop()

    def _sigterm_handler() -> None:
        logger.info("SIGTERM received — stopping webhook server…")
        raise web.GracefulExit

    loop.add_signal_handler(signal.SIGTERM, _sigterm_handler)

    logger.info("Starting VLIQ bot (webhook mode)…")
    web.run_app(app, host="0.0.0.0", port=BOT_WEBHOOK_PORT)


if __name__ == "__main__":
    asyncio.run(main())
