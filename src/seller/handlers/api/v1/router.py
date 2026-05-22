from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from src.seller.depends import get_seller_repository
from src.seller.repository import SellerRepository
from src.seller.schemas.api import SellerCreate, SellerRead, SellerTgUpsertRequest, SellerUpdate

router = APIRouter(prefix="/sellers", tags=["Seller"])


@router.post(
    "/tg-upsert",
    response_model=SellerRead,
    status_code=status.HTTP_200_OK,
    summary="Создать или обновить seller по telegram_id (без авторизации)",
)
async def sellers_tg_upsert(
    body: SellerTgUpsertRequest,
    repo: Annotated[SellerRepository, Depends(get_seller_repository)],
) -> SellerRead:
    seller = await repo.ensure_seller(
        telegram_id=body.id,
        brand_id=body.brand_id,
        phone_e164=body.phone_e164,
        first_name=body.first_name,
        last_name=body.last_name,
    )
    return SellerRead.model_validate(seller, from_attributes=True)


@router.post("", response_model=SellerRead, status_code=status.HTTP_201_CREATED)
async def create_seller(payload: SellerCreate) -> SellerRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[SellerRead])
async def list_sellers() -> list[SellerRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{telegram_id}", response_model=SellerRead)
async def get_seller(telegram_id: int) -> SellerRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{telegram_id}", response_model=SellerRead)
async def update_seller(telegram_id: int, payload: SellerUpdate) -> SellerRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{telegram_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_seller(telegram_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
