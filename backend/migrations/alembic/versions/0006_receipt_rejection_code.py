"""Add receipt.rejection_code — machine-readable rejection cause.

``rejection_reason`` stays the user-facing text; ``rejection_code`` is a stable
machine code so the admin can distinguish a *system* rejection
(``MULTIPLE_RECEIPTS_DETECTED``) from an ordinary admin rejection (code NULL).
Nullable, no index (queried per-receipt, not scanned).

Revision ID: 0006_receipt_rejection_code
Revises: 0005_receipt_attachments
Create Date: 2026-06-22 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0006_receipt_rejection_code"
down_revision: str | None = "0005_receipt_attachments"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    op.add_column("receipt", sa.Column("rejection_code", sa.String(64), nullable=True), schema=SCHEMA)


def downgrade() -> None:
    op.drop_column("receipt", "rejection_code", schema=SCHEMA)
