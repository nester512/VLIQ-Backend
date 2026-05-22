from fastapi import APIRouter, HTTPException, status

from src.bonus_transaction.schemas.api import (
    BonusTransactionCreate,
    BonusTransactionRead,
    BonusTransactionUpdate,
)

router = APIRouter(prefix="/bonus-transactions", tags=["BonusTransaction"])


@router.post("", response_model=BonusTransactionRead, status_code=status.HTTP_201_CREATED)
async def create_bonus_transaction(payload: BonusTransactionCreate) -> BonusTransactionRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[BonusTransactionRead])
async def list_bonus_transactions() -> list[BonusTransactionRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{bonus_transaction_id}", response_model=BonusTransactionRead)
async def get_bonus_transaction(bonus_transaction_id: int) -> BonusTransactionRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{bonus_transaction_id}", response_model=BonusTransactionRead)
async def update_bonus_transaction(
    bonus_transaction_id: int, payload: BonusTransactionUpdate
) -> BonusTransactionRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{bonus_transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_bonus_transaction(bonus_transaction_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
