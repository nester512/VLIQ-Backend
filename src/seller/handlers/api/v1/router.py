from fastapi import APIRouter, HTTPException, status

from src.seller.schemas.api import SellerCreate, SellerRead, SellerUpdate

router = APIRouter(prefix="/sellers", tags=["Seller"])


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
