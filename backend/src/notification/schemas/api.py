from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from src.notification.models import NotificationDeliveryStatus, NotificationType


class NotificationCreate(BaseModel):
    seller_id: int = Field(..., description="Recipient seller telegram_id")
    type: NotificationType
    payload: dict[str, Any] = Field(default_factory=dict)
    telegram_message_id: int | None = None
    sent_at: datetime | None = None
    read_at: datetime | None = None
    delivery_status: NotificationDeliveryStatus = NotificationDeliveryStatus.queued


class NotificationUpdate(BaseModel):
    payload: dict[str, Any] | None = None
    telegram_message_id: int | None = None
    sent_at: datetime | None = None
    read_at: datetime | None = None
    delivery_status: NotificationDeliveryStatus | None = None


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seller_id: int
    type: NotificationType
    payload: dict[str, Any]
    telegram_message_id: int | None = None
    sent_at: datetime | None = None
    read_at: datetime | None = None
    delivery_status: NotificationDeliveryStatus
    created_at: datetime
