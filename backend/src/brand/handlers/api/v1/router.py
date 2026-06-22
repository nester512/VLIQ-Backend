from fastapi import APIRouter, status

from src.app.errors import AppError
from src.brand.schemas.api import BrandCreate, BrandRead, BrandUpdate

router = APIRouter(prefix="/brands", tags=["Brand"])


@router.post("", response_model=BrandRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def create_brand(payload: BrandCreate) -> BrandRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get("", response_model=list[BrandRead], include_in_schema=False)
async def list_brands() -> list[BrandRead]:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.get("/{brand_id}", response_model=BrandRead, include_in_schema=False)
async def get_brand(brand_id: int) -> BrandRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.patch("/{brand_id}", response_model=BrandRead, include_in_schema=False)
async def update_brand(brand_id: int, payload: BrandUpdate) -> BrandRead:
    raise AppError("NOT_IMPLEMENTED", status_code=501)


@router.delete("/{brand_id}", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def delete_brand(brand_id: int) -> None:
    raise AppError("NOT_IMPLEMENTED", status_code=501)
