"""The bank the seller receives the SBP transfer in (UC-S7 «Банк получателя»).

PRODUCTION SAFETY: additive only — two NULL columns, no default (metadata-only, no table
rewrite, no lock beyond a brief ACCESS EXCLUSIVE for the catalog update); old requests keep
NULL = «банк не указан»; re-runnable (IF NOT EXISTS).

Revision ID: 0015_payout_bank
Revises: 0014_backfill_paid_out
Create Date: 2026-11-11 00:00:00.000000
"""
from __future__ import annotations

from alembic import op

revision: str = "0015_payout_bank"
down_revision: str | None = "0014_backfill_paid_out"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    op.execute(f"ALTER TABLE {SCHEMA}.payout_request ADD COLUMN IF NOT EXISTS bank_id VARCHAR(16)")
    op.execute(f"ALTER TABLE {SCHEMA}.payout_request ADD COLUMN IF NOT EXISTS bank_name VARCHAR(128)")


def downgrade() -> None:
    op.execute(f"ALTER TABLE {SCHEMA}.payout_request DROP COLUMN IF EXISTS bank_name")
    op.execute(f"ALTER TABLE {SCHEMA}.payout_request DROP COLUMN IF EXISTS bank_id")
