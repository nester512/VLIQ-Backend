"""Add admin_comments to receipt + seed admin rows via migration note.

Actually this migration:
 1. Adds `admin_comments` JSONB column to vliq.receipt (T4).
 2. Creates vliq.admin if it somehow does not exist yet (defensive — 0001 should have created it,
    but the production environment reports the table missing).

Revision ID: 0003_admin_table
Revises: 0002_notification_outbox
Create Date: 2026-05-30 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import ENUM as PgEnum

# revision identifiers, used by Alembic.
revision: str = "0003_admin_table"
down_revision: str | None = "0002_notification_outbox"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    # ------------------------------------------------------------------
    # Defensive: create vliq.admin if it does not exist.
    # In environments where 0001_initial ran without the admin block this
    # ensures the table is present before the application starts.
    # ------------------------------------------------------------------
    op.execute(
        """
        DO $$ BEGIN
            CREATE TYPE vliq.admin_role_enum AS ENUM ('admin', 'super_admin');
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        """
    )

    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.admin (
            telegram_id  BIGINT        NOT NULL,
            phone_e164   VARCHAR(32)   NOT NULL,
            first_name   VARCHAR(255),
            last_name    VARCHAR(255),
            role         {SCHEMA}.admin_role_enum NOT NULL DEFAULT 'admin',
            brand_ids    JSONB         NOT NULL DEFAULT '[]'::jsonb,
            is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
            created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
            updated_at   TIMESTAMPTZ            DEFAULT NOW(),
            created_by   BIGINT,
            updated_by   BIGINT,
            CONSTRAINT admin_pkey PRIMARY KEY (telegram_id),
            CONSTRAINT admin_phone_e164_key UNIQUE (phone_e164)
        )
        """
    )

    # Indexes — use IF NOT EXISTS so this is safe to re-apply.
    op.execute(
        f"CREATE INDEX IF NOT EXISTS vliq_admin_role_idx     ON {SCHEMA}.admin (role)"
    )
    op.execute(
        f"CREATE INDEX IF NOT EXISTS vliq_admin_is_active_idx ON {SCHEMA}.admin (is_active)"
    )

    # ------------------------------------------------------------------
    # T4: Add admin_comments JSONB array column to receipt.
    # Stores [{author_telegram_id, text, created_at}, ...] inline.
    # ------------------------------------------------------------------
    op.execute(
        f"""
        ALTER TABLE {SCHEMA}.receipt
            ADD COLUMN IF NOT EXISTS admin_comments JSONB NOT NULL DEFAULT '[]'::jsonb
        """
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {SCHEMA}.receipt DROP COLUMN IF EXISTS admin_comments")
    # We intentionally do NOT drop the admin table in downgrade because
    # it was created by 0001_initial and might contain live data.
