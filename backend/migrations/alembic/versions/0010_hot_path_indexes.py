"""Indexes for the hot read paths; drop indexes that only cost writes.

Measured on stage (75k receipts, 2k sellers) before this migration:
- review queue page (status=on_review ORDER BY created_at, id) — bitmap scan of
  7k rows + sort, 14 ms;
- receipts archive by status, newest first — parallel seq scan, 25 ms;
- dashboard «receipts per day, 30 days» — seq scan, 18 ms.

Added (all partial on live rows — every read filters ``is_deleted = false``):
- ``ix_receipt_live_status_created``  (status, created_at, id)
- ``ix_receipt_live_created``         (created_at DESC, id DESC)
- ``ix_receipt_live_seller_created``  (seller_id, created_at DESC, id DESC)
- ``ix_notification_seller_created``  (seller_id, created_at DESC)

Dropped (pure write overhead, fully covered by another index):
- ``vliq_receipt_is_deleted_idx``                — boolean, never selective;
- ``vliq_seller_phone_e164_idx``                 — duplicate of the UNIQUE key;
- ``vliq_bonus_transaction_seller_id_idx``       — prefix of ix_bonus_tx_seller_brand_created;
- ``vliq_payout_request_seller_id_idx``          — prefix of ix_payout_seller_status;
- ``ix_receipt_verification_attempt_receipt_id`` — prefix of the UNIQUE (receipt_id, attempt_no).

PRODUCTION SAFETY (docs: CLAUDE.md «Безопасность данных при деплое»):
- No data is read or changed — indexes only.
- Every statement runs CONCURRENTLY outside a transaction: the tables stay
  writable while indexes build, sellers keep uploading during the deploy.
- Idempotent: IF [NOT] EXISTS everywhere; an index left INVALID by an interrupted
  CONCURRENTLY build is dropped and rebuilt on the next run.
- Downgrade restores the exact previous index set.

Revision ID: 0010_hot_path_indexes
Revises: 0009_qr_intake
Create Date: 2026-10-09 00:00:00.000000
"""
from __future__ import annotations

from alembic import op

revision: str = "0010_hot_path_indexes"
down_revision: str | None = "0009_qr_intake"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"

NEW_INDEXES: dict[str, str] = {
    "ix_receipt_live_status_created": "receipt (status, created_at, id) WHERE is_deleted = false",
    "ix_receipt_live_created": "receipt (created_at DESC, id DESC) WHERE is_deleted = false",
    "ix_receipt_live_seller_created": "receipt (seller_id, created_at DESC, id DESC) WHERE is_deleted = false",
    "ix_notification_seller_created": "notification (seller_id, created_at DESC)",
}

REDUNDANT_INDEXES: dict[str, str] = {
    "vliq_receipt_is_deleted_idx": "receipt (is_deleted)",
    "vliq_seller_phone_e164_idx": "seller (phone_e164)",
    "vliq_bonus_transaction_seller_id_idx": "bonus_transaction (seller_id)",
    "vliq_payout_request_seller_id_idx": "payout_request (seller_id)",
    "ix_receipt_verification_attempt_receipt_id": "receipt_verification_attempt (receipt_id)",
}


def _drop_if_invalid(name: str) -> None:
    """An interrupted CREATE INDEX CONCURRENTLY leaves an INVALID index that
    IF NOT EXISTS would silently keep — drop it so it is rebuilt."""
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_index i
                JOIN pg_class c ON c.oid = i.indexrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = '{SCHEMA}' AND c.relname = '{name}' AND NOT i.indisvalid
            ) THEN
                EXECUTE 'DROP INDEX {SCHEMA}.{name}';
            END IF;
        END $$;
        """
    )


def _create(name: str, definition: str) -> None:
    _drop_if_invalid(name)
    op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {SCHEMA}.{definition}")


def _drop(name: str) -> None:
    op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {SCHEMA}.{name}")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        # Build the new indexes first: reads never lose an index they relied on.
        for name, definition in NEW_INDEXES.items():
            _create(name, definition)
        for name in REDUNDANT_INDEXES:
            _drop(name)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, definition in REDUNDANT_INDEXES.items():
            _create(name, definition)
        for name in NEW_INDEXES:
            _drop(name)
