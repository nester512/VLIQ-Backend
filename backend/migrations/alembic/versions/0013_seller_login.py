"""Seller account recovery: a new Telegram account can log in as an existing seller.

docs/procedures/ACCOUNT-RECOVERY.md. A seller's identity stays his original
``telegram_id`` (every receipt, ledger row and payout keeps pointing at it — no data
moves); ``seller_login`` lists OTHER Telegram accounts allowed to log in as him, added
only by a super_admin after an identity check; the lost account is switched off with
``seller.primary_login_disabled``.

PRODUCTION SAFETY: additive only — one new table, one column with a constant default
(metadata-only in PostgreSQL ≥ 11, no table rewrite); re-runnable (IF NOT EXISTS).

Revision ID: 0013_seller_login
Revises: 0012_payouts
Create Date: 2026-10-09 00:00:00.000000
"""
from __future__ import annotations

from alembic import op

revision: str = "0013_seller_login"
down_revision: str | None = "0012_payouts"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    op.execute(
        f"ALTER TABLE {SCHEMA}.seller ADD COLUMN IF NOT EXISTS primary_login_disabled BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {SCHEMA}.seller_login (
            telegram_id BIGINT PRIMARY KEY,
            seller_id BIGINT NOT NULL REFERENCES {SCHEMA}.seller (telegram_id) ON DELETE RESTRICT,
            reason TEXT NOT NULL,
            created_by BIGINT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            revoked_at TIMESTAMPTZ
        )
        """
    )
    op.execute(f"CREATE INDEX IF NOT EXISTS ix_seller_login_seller ON {SCHEMA}.seller_login (seller_id)")


def downgrade() -> None:
    op.execute(f"DROP TABLE IF EXISTS {SCHEMA}.seller_login")
    op.execute(f"ALTER TABLE {SCHEMA}.seller DROP COLUMN IF EXISTS primary_login_disabled")
