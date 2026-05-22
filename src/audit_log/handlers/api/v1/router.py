from fastapi import APIRouter, HTTPException, status

from src.audit_log.schemas.api import AuditLogCreate, AuditLogRead, AuditLogUpdate

router = APIRouter(prefix="/audit-logs", tags=["AuditLog"])


@router.post("", response_model=AuditLogRead, status_code=status.HTTP_201_CREATED)
async def create_audit_log(payload: AuditLogCreate) -> AuditLogRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("", response_model=list[AuditLogRead])
async def list_audit_logs() -> list[AuditLogRead]:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.get("/{audit_log_id}", response_model=AuditLogRead)
async def get_audit_log(audit_log_id: int) -> AuditLogRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.patch("/{audit_log_id}", response_model=AuditLogRead)
async def update_audit_log(audit_log_id: int, payload: AuditLogUpdate) -> AuditLogRead:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")


@router.delete("/{audit_log_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_audit_log(audit_log_id: int) -> None:
    raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, "Not implemented")
