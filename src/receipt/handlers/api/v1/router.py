from fastapi import APIRouter, HTTPException, status

from src.receipt.schemas.api import ReceiptCreate, ReceiptRead, ReceiptUpdate

router = APIRouter(prefix="/receipts", tags=["Receipt"])


@router.post("", response_model=ReceiptRead, status_code=status.HTTP_201_CREATED)
async def create_receipt(payload: ReceiptCreate) -> ReceiptRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[ReceiptRead])
async def list_receipts() -> list[ReceiptRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{receipt_id}", response_model=ReceiptRead)
async def get_receipt(receipt_id: int) -> ReceiptRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{receipt_id}", response_model=ReceiptRead)
async def update_receipt(receipt_id: int, payload: ReceiptUpdate) -> ReceiptRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_receipt(receipt_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
