from fastapi import APIRouter, HTTPException, status

from src.admin.schemas.api import AdminCreate, AdminRead, AdminUpdate

router = APIRouter(prefix="/admins", tags=["Admin"])


@router.post("", response_model=AdminRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_admin(payload: AdminCreate) -> AdminRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[AdminRead], include_in_schema=False)
async def list_admins() -> list[AdminRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{telegram_id}", response_model=AdminRead, include_in_schema=False)
async def get_admin(telegram_id: int) -> AdminRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{telegram_id}", response_model=AdminRead, include_in_schema=False)
async def update_admin(telegram_id: int, payload: AdminUpdate) -> AdminRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{telegram_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_admin(telegram_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
