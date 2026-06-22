"""Notification sender — delivers Telegram messages for queued Notification rows.

Generates message text from the notification type + payload, sends via the
Telegram Bot API, and updates delivery_status / sent_at on success.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.app.telegram_bot import TelegramBotClient
from src.notification.formatting import render_money_payload
from src.notification.models import Notification, NotificationDeliveryStatus
from src.seller.models import Seller

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Message templates
# ---------------------------------------------------------------------------

_TEMPLATES: dict[str, str] = {
    "receipt_approved": (
        "✅ Чек №{receipt_id} одобрен!\nНачислено: <b>+{bonus_amount} ₽</b>\nДоступно к выплате: {available} ₽"
    ),
    "receipt_rejected": ("❌ Чек №{receipt_id} отклонён\nПричина: {reason}"),
    "bonus_accrued": "🎁 Вам начислено {amount} ₽ — {reason}",
    "payout_sent": "💸 Выплата {amount} ₽ отправлена на {payout_masked}",
    "promo_started": "🎯 Новая акция: <b>{name}</b>\n{description}",
    "promo_ending": "⏰ Акция «{name}» скоро закончится",
}


def _render_text(notification_type: str, payload: dict[str, Any]) -> str:
    """Render a notification message from its type and payload.

    Falls back to a generic message if the type is unknown.
    """
    template = _TEMPLATES.get(notification_type)
    if template is None:
        logger.warning("notification.unknown_type type=%s", notification_type)
        return f"📬 Уведомление: {notification_type}"
    try:
        # Money fields are stored in kopecks — convert to rubles before rendering ₽.
        return template.format_map(render_money_payload(payload))
    except KeyError as exc:
        logger.warning(
            "notification.template_missing_key type=%s key=%s",
            notification_type,
            exc,
        )
        # Return partial render with missing keys shown as placeholders.
        return template


# ---------------------------------------------------------------------------
# Sender
# ---------------------------------------------------------------------------


class NotificationSender:
    """Sends a single Notification to the seller via Telegram.

    Args:
        bot: Telegram Bot API client.
        session_maker: Async session factory (used when session is not passed directly).
    """

    def __init__(self, bot: TelegramBotClient, session_maker: async_sessionmaker[AsyncSession]) -> None:
        self._bot = bot
        self._session_maker = session_maker

    async def send(self, notification: Notification, *, session: AsyncSession) -> None:
        """Send the notification and update its delivery state.

        Args:
            notification: ORM model instance (must be attached to *session*).
            session: Active SQLAlchemy session; the caller manages the transaction.
        """
        # 1. Load seller to get telegram_id.
        seller_row = (
            await session.execute(select(Seller).where(Seller.telegram_id == notification.seller_id))
        ).scalar_one_or_none()

        if seller_row is None:
            logger.warning(
                "notification.seller_not_found notification_id=%s seller_id=%s",
                notification.id,
                notification.seller_id,
            )
            await _mark_failed(session, notification)
            return

        # 2. Build message text.
        text = _render_text(notification.type, notification.payload)

        # 3. Send via Bot API.
        try:
            result = await self._bot.send_message(
                chat_id=seller_row.telegram_id,
                text=text,
                parse_mode="HTML",
            )
            tg_message_id: int | None = result.get("message_id")
        except Exception as exc:
            logger.error(
                "notification.send_failed notification_id=%s seller_id=%s error=%s",
                notification.id,
                notification.seller_id,
                exc,
            )
            await _mark_failed(session, notification)
            return

        # 4. Update delivery state.
        now = datetime.now(tz=UTC)
        await session.execute(
            update(Notification)
            .where(Notification.id == notification.id)
            .values(
                sent_at=now,
                delivery_status=NotificationDeliveryStatus.sent.value,
                telegram_message_id=tg_message_id,
            )
        )
        logger.info(
            "notification.sent notification_id=%s seller_id=%s tg_message_id=%s",
            notification.id,
            notification.seller_id,
            tg_message_id,
        )


async def _mark_failed(session: AsyncSession, notification: Notification) -> None:
    """Set delivery_status=failed on the notification row."""
    await session.execute(
        update(Notification)
        .where(Notification.id == notification.id)
        .values(delivery_status=NotificationDeliveryStatus.failed.value)
    )
