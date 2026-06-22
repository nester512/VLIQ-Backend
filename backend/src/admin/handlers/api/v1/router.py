from fastapi import APIRouter, status

from src.admin.schemas.api import AdminCreate, AdminRead, AdminUpdate
from src.app.errors import AppError

router = APIRouter(prefix="/admins", tags=["Admin"])


@router.post("", response_model=AdminRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_admin(payload: AdminCreate) -> AdminRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get("", response_model=list[AdminRead], include_in_schema=False)
async def list_admins() -> list[AdminRead]:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get("/{telegram_id}", response_model=AdminRead, include_in_schema=False)
async def get_admin(telegram_id: int) -> AdminRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.patch("/{telegram_id}", response_model=AdminRead, include_in_schema=False)
async def update_admin(telegram_id: int, payload: AdminUpdate) -> AdminRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.delete("/{telegram_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_admin(telegram_id: int) -> None:
    raise AppError("NOT_IMPLEMENTED", status_code=501)
