from fastapi import APIRouter, HTTPException, status

from src.promotion.schemas.api import PromotionCreate, PromotionRead, PromotionUpdate

router = APIRouter(prefix="/promotions", tags=["Promotion"])


@router.post("", response_model=PromotionRead, status_code=status.HTTP_201_CREATED)
async def create_promotion(payload: PromotionCreate) -> PromotionRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[PromotionRead])
async def list_promotions() -> list[PromotionRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{promotion_id}", response_model=PromotionRead)
async def get_promotion(promotion_id: int) -> PromotionRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{promotion_id}", response_model=PromotionRead)
async def update_promotion(promotion_id: int, payload: PromotionUpdate) -> PromotionRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_promotion(promotion_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
