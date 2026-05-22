from fastapi import APIRouter, HTTPException, status

from src.payout_request.schemas.api import (
    PayoutRequestCreate,
    PayoutRequestRead,
    PayoutRequestUpdate,
)

router = APIRouter(prefix="/payout-requests", tags=["PayoutRequest"])


@router.post("", response_model=PayoutRequestRead, status_code=status.HTTP_201_CREATED)
async def create_payout_request(payload: PayoutRequestCreate) -> PayoutRequestRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[PayoutRequestRead])
async def list_payout_requests() -> list[PayoutRequestRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{payout_request_id}", response_model=PayoutRequestRead)
async def get_payout_request(payout_request_id: int) -> PayoutRequestRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{payout_request_id}", response_model=PayoutRequestRead)
async def update_payout_request(payout_request_id: int, payload: PayoutRequestUpdate) -> PayoutRequestRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{payout_request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_payout_request(payout_request_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
