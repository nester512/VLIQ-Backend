from fastapi import APIRouter, HTTPException, status

from src.brand.schemas.api import BrandCreate, BrandRead, BrandUpdate

router = APIRouter(prefix="/brands", tags=["Brand"])


@router.post("", response_model=BrandRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_brand(payload: BrandCreate) -> BrandRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[BrandRead], include_in_schema=False)
async def list_brands() -> list[BrandRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{brand_id}", response_model=BrandRead, include_in_schema=False)
async def get_brand(brand_id: int) -> BrandRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{brand_id}", response_model=BrandRead, include_in_schema=False)
async def update_brand(brand_id: int, payload: BrandUpdate) -> BrandRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_brand(brand_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
