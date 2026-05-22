from fastapi import APIRouter, HTTPException, status

from src.sku.schemas.api import SkuCreate, SkuRead, SkuUpdate

router = APIRouter(prefix="/skus", tags=["Sku"])


@router.post("", response_model=SkuRead, status_code=status.HTTP_201_CREATED)
async def create_sku(payload: SkuCreate) -> SkuRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[SkuRead])
async def list_skus() -> list[SkuRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{sku_id}", response_model=SkuRead)
async def get_sku(sku_id: int) -> SkuRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{sku_id}", response_model=SkuRead)
async def update_sku(sku_id: int, payload: SkuUpdate) -> SkuRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{sku_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sku(sku_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
