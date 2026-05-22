from fastapi import APIRouter, HTTPException, status

from src.notification.schemas.api import (
    NotificationCreate,
    NotificationRead,
    NotificationUpdate,
)

router = APIRouter(prefix="/notifications", tags=["Notification"])


@router.post("", response_model=NotificationRead, status_code=status.HTTP_201_CREATED)
async def create_notification(payload: NotificationCreate) -> NotificationRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[NotificationRead])
async def list_notifications() -> list[NotificationRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{notification_id}", response_model=NotificationRead)
async def get_notification(notification_id: int) -> NotificationRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{notification_id}", response_model=NotificationRead)
async def update_notification(notification_id: int, payload: NotificationUpdate) -> NotificationRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_notification(notification_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
