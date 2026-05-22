from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from src.audit_log.models import ActorType


class AuditLogCreate(BaseModel):
    actor_id: int = Field(..., description="Polymorphic actor ID (no FK); discriminated by actor_type")
    actor_type: ActorType
    action: str = Field(..., max_length=64, description="Action verb, e.g. approve_receipt")
    entity_type: str = Field(..., max_length=32, description="receipt | payout | seller | promotion")
    entity_id: int
    comment: Optional[str] = None
    payload: Optional[dict[str, Any]] = None


class AuditLogUpdate(BaseModel):
    # Audit rows are append-only; included for API symmetry only.
    comment: Optional[str] = None
    payload: Optional[dict[str, Any]] = None


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_id: int
    actor_type: ActorType
    action: str
    entity_type: str
    entity_id: int
    comment: Optional[str] = None
    payload: Optional[dict[str, Any]] = None
    created_at: datetime
