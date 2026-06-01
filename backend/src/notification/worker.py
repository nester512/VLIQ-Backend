"""Notification outbox worker.

Drains the ``notification_outbox`` table every 5 seconds and delivers
messages via the appropriate channel (Telegram or in-app).

Telegram delivery:
  - HTTP 429 with retry_after  → schedule with that delay.
  - HTTP 5xx                   → exponential backoff via mark_failed.
  - HTTP 4xx (other than 429)  → mark dead immediately (bad request).

In-app delivery:
  - Inserts a row into the existing ``notification`` table so the TMA
    can poll it.  If an in-app row was already created inline by the
    request handler this channel is a no-op (channel='in_app' not currently
    enqueued by handlers, so no duplication risk).

Graceful shutdown:
  - SIGTERM sets a stop event; the loop exits after the current batch.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import signal
from datetime import UTC, datetime

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.notification import outbox as notification_outbox
from src.notification.models import Notification, NotificationDeliveryStatus, NotificationType

_HTTP_TOO_MANY_REQUESTS = 429
_HTTP_CLIENT_ERROR_MIN = 400
_HTTP_CLIENT_ERROR_MAX = 500

logger = logging.getLogger(__name__)

_POLL_INTERVAL = 5  # seconds between drain cycles
_BATCH_SIZE = 50

# ---------------------------------------------------------------------------
# Message templates (mirrored from sender.py — kept simple for the outbox)
# ---------------------------------------------------------------------------

_TEMPLATES: dict[str, str] = {
    "receipt.approved": (
        "✅ Чек №{receipt_id} одобрен!\nНачислено: <b>+{bonus_amount} ₽</b>\nДоступно к выплате: {available} ₽"
    ),
    "receipt.rejected": "❌ Чек №{receipt_id} отклонён\nПричина: {reason}",
    "payout.sent": "💸 Выплата {amount} ₽ отправлена на {payout_masked}",
}


def _render(template: str, payload: dict) -> str:
    tpl = _TEMPLATES.get(template)
    if tpl is None:
        return f"📬 Уведомление: {template}"
    try:
        return tpl.format_map(payload)
    except KeyError:
        return tpl


# ---------------------------------------------------------------------------
# Telegram send helper
# ---------------------------------------------------------------------------


async def _send_telegram(
    http_client: httpx.AsyncClient,
    *,
    bot_token: str,
    chat_id: int,
    text: str,
) -> None:
    """Send a Telegram message.

    Raises:
        httpx.HTTPStatusError on HTTP errors (caller inspects status code).
    """
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    resp = await http_client.post(
        url,
        json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        timeout=10.0,
    )
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Process a single outbox row
# ---------------------------------------------------------------------------


async def _process_row(
    session: AsyncSession,
    row,
    *,
    http_client: httpx.AsyncClient,
    bot_token: str,
) -> None:
    """Attempt delivery for one outbox row; update status on success or failure."""
    if row.channel == "telegram":
        text = _render(row.template, row.payload)
        try:
            await _send_telegram(
                http_client,
                bot_token=bot_token,
                chat_id=row.recipient_id,
                text=text,
            )
            await notification_outbox.mark_sent(session, row)

        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code

            if status_code == _HTTP_TOO_MANY_REQUESTS:
                # Respect Telegram's retry_after if present.
                try:
                    retry_after = int(exc.response.json().get("parameters", {}).get("retry_after", 60))
                except Exception:
                    retry_after = 60
                from datetime import timedelta

                from sqlalchemy import update as sa_update

                next_scheduled = datetime.now(tz=UTC) + timedelta(seconds=retry_after)
                await session.execute(
                    sa_update(type(row))
                    .where(type(row).id == row.id)
                    .values(
                        attempts=row.attempts + 1,
                        last_error=f"HTTP 429 retry_after={retry_after}",
                        scheduled_at=next_scheduled,
                    )
                )
                logger.warning(
                    "outbox.telegram_429 id=%s retry_after=%s",
                    row.id,
                    retry_after,
                )
            elif _HTTP_CLIENT_ERROR_MIN <= status_code < _HTTP_CLIENT_ERROR_MAX:
                # Permanent client error — mark dead immediately.
                from sqlalchemy import update as sa_update

                await session.execute(
                    sa_update(type(row))
                    .where(type(row).id == row.id)
                    .values(
                        status="dead",
                        attempts=row.attempts + 1,
                        last_error=f"HTTP {status_code}: {exc.response.text[:200]}",
                    )
                )
                logger.error(
                    "outbox.telegram_4xx_dead id=%s status=%s",
                    row.id,
                    status_code,
                )
            else:
                # 5xx or other — exponential backoff.
                await notification_outbox.mark_failed(
                    session,
                    row,
                    error=f"HTTP {status_code}: {exc.response.text[:200]}",
                )

        except Exception as exc:
            await notification_outbox.mark_failed(session, row, error=str(exc))

    elif row.channel == "in_app":
        # Insert into the existing notifications table.
        # Mapping from outbox template → NotificationType enum value.
        _TEMPLATE_TO_TYPE: dict[str, str] = {
            "receipt.approved": NotificationType.receipt_approved.value,
            "receipt.rejected": NotificationType.receipt_rejected.value,
            "payout.sent": NotificationType.payout_sent.value,
        }
        notif_type = _TEMPLATE_TO_TYPE.get(row.template)
        if notif_type is None:
            await notification_outbox.mark_failed(
                session, row, error=f"Unknown in_app template: {row.template}"
            )
            return

        notif = Notification(
            seller_id=row.recipient_id,
            type=notif_type,
            payload=row.payload,
            delivery_status=NotificationDeliveryStatus.sent.value,
            sent_at=datetime.now(tz=UTC),
        )
        session.add(notif)
        await notification_outbox.mark_sent(session, row)

    else:
        await notification_outbox.mark_failed(
            session, row, error=f"Unknown channel: {row.channel}"
        )


# ---------------------------------------------------------------------------
# Main worker loop
# ---------------------------------------------------------------------------


async def run_worker() -> None:
    """Entry point for the notification outbox worker process."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    pg_url = os.environ.get(
        "POSTGRES__POSTGRES_URL",
        "postgresql+asyncpg://vliq:vliq_dev@localhost:5432/vliq",
    )
    bot_token = os.environ.get("TG_BOT_TOKEN", "")

    if not bot_token:
        logger.warning("worker.no_bot_token — telegram delivery will fail")

    engine = create_async_engine(pg_url, pool_pre_ping=True, pool_size=5)
    session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
        engine, expire_on_commit=False
    )

    stop_event = asyncio.Event()

    def _handle_sigterm(*_) -> None:  # noqa: ANN002
        logger.info("worker.sigterm_received — shutting down gracefully")
        stop_event.set()

    signal.signal(signal.SIGTERM, _handle_sigterm)
    signal.signal(signal.SIGINT, _handle_sigterm)

    logger.info("worker.started poll_interval=%ds batch_size=%d", _POLL_INTERVAL, _BATCH_SIZE)

    async with httpx.AsyncClient() as http_client:
        while not stop_event.is_set():
            try:
                await _drain_cycle(
                    session_factory,
                    http_client=http_client,
                    bot_token=bot_token,
                )
            except Exception as exc:
                logger.error("worker.drain_cycle_error: %s", exc, exc_info=True)

            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(stop_event.wait(), timeout=_POLL_INTERVAL)

    await engine.dispose()
    logger.info("worker.stopped")


async def _drain_cycle(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    http_client: httpx.AsyncClient,
    bot_token: str,
) -> None:
    """Open a session, drain due rows, process each one."""
    async with session_factory() as session, session.begin():
        rows = await notification_outbox.drain_due(session, batch_size=_BATCH_SIZE)
        for row in rows:
            await _process_row(
                session,
                row,
                http_client=http_client,
                bot_token=bot_token,
            )
        # Refresh Prometheus gauges once per cycle (lightweight COUNT queries).
        await notification_outbox.refresh_outbox_gauges(session)
    if rows:
        logger.info("worker.cycle processed=%d", len(rows))
