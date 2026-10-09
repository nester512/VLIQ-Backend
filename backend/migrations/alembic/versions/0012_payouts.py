"""Payouts: request lifecycle timestamps, DB-level idempotency, payout ↔ receipt coverage.

docs/design/PAYOUTS.md. A payout request now records when it was taken / paid /
rejected, carries the seller's idempotency key (UNIQUE per seller — a repeated
submit returns the same request), and is linked to the approved receipts it
covers (``payout_receipt``, FIFO by receipt age) so that paying it can mark each
covered receipt «Выплачен» (BRD В-8-A).

PRODUCTION SAFETY (CLAUDE.md «Безопасность данных при деплое»):
- additive only: nullable columns, one new table, one new index (CONCURRENTLY);
- ``paid_at`` / ``rejected_at`` of already decided requests are filled from
  ``updated_at`` (only where NULL — idempotent; ``updated_at`` is kept);
- coverage of existing requests is INSERTed into the new table with the same FIFO
  rule the service uses, only for sellers that have no coverage rows yet
  (idempotent); existing rows of every other table are not modified — receipt
  statuses in particular stay as they are (see ops/backfill_paid_out.sql).

Revision ID: 0012_payouts
Revises: 0011_receipt_journey
Create Date: 2026-10-09 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0012_payouts"
down_revision: str | None = "0011_receipt_journey"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"
IDEM_INDEX = "uq_payout_request_seller_idem"

# FIFO coverage = overlap of two cumulative ranges per seller: receipts (approved or
# paid out, oldest first, by bonus) and non-rejected payouts (oldest first, by amount).
COVERAGE = f"""
WITH r AS (
    SELECT id, seller_id,
           sum(bonus_amount) OVER w - bonus_amount AS lo, sum(bonus_amount) OVER w AS hi
    FROM {SCHEMA}.receipt
    WHERE is_deleted = false AND status IN ('approved', 'paid_out') AND bonus_amount > 0
    WINDOW w AS (PARTITION BY seller_id ORDER BY created_at, id)
), p AS (
    SELECT id, seller_id, sum(amount) OVER w - amount AS lo, sum(amount) OVER w AS hi
    FROM {SCHEMA}.payout_request
    WHERE status <> 'rejected'
    WINDOW w AS (PARTITION BY seller_id ORDER BY created_at, id)
)
INSERT INTO {SCHEMA}.payout_receipt (payout_id, receipt_id, amount)
SELECT p.id, r.id, least(r.hi, p.hi) - greatest(r.lo, p.lo)
FROM p JOIN r ON r.seller_id = p.seller_id AND r.lo < p.hi AND p.lo < r.hi
WHERE NOT EXISTS (
    SELECT 1 FROM {SCHEMA}.payout_receipt x
    JOIN {SCHEMA}.payout_request y ON y.id = x.payout_id
    WHERE y.seller_id = p.seller_id
)
"""


def upgrade() -> None:
    for name, col in (
        ("taken_at", sa.Column("taken_at", sa.TIMESTAMP(timezone=True), nullable=True)),
        ("paid_at", sa.Column("paid_at", sa.TIMESTAMP(timezone=True), nullable=True)),
        ("rejected_at", sa.Column("rejected_at", sa.TIMESTAMP(timezone=True), nullable=True)),
        ("idempotency_key", sa.Column("idempotency_key", sa.String(64), nullable=True)),
    ):
        op.add_column("payout_request", col, schema=SCHEMA)
        del name

    op.create_table(
        "payout_receipt",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "payout_id", sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.payout_request.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column(
            "receipt_id", sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.receipt.id", ondelete="RESTRICT"), nullable=False,
        ),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_payout_receipt_amount_positive"),
        sa.UniqueConstraint("payout_id", "receipt_id", name="uq_payout_receipt"),
        schema=SCHEMA,
    )
    op.create_index("ix_payout_receipt_receipt", "payout_receipt", ["receipt_id"], schema=SCHEMA)

    op.execute(
        f"UPDATE {SCHEMA}.payout_request SET paid_at = updated_at "
        "WHERE status = 'paid' AND paid_at IS NULL"
    )
    op.execute(
        f"UPDATE {SCHEMA}.payout_request SET rejected_at = updated_at "
        "WHERE status = 'rejected' AND rejected_at IS NULL"
    )
    op.execute(COVERAGE)

    with op.get_context().autocommit_block():
        op.execute(
            f"""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = '{SCHEMA}' AND c.relname = '{IDEM_INDEX}' AND NOT i.indisvalid
                ) THEN
                    EXECUTE 'DROP INDEX {SCHEMA}.{IDEM_INDEX}';
                END IF;
            END $$;
            """
        )
        op.execute(
            f"CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS {IDEM_INDEX} "
            f"ON {SCHEMA}.payout_request (seller_id, idempotency_key) WHERE idempotency_key IS NOT NULL"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {SCHEMA}.{IDEM_INDEX}")
    op.drop_table("payout_receipt", schema=SCHEMA)
    for col in ("idempotency_key", "rejected_at", "paid_at", "taken_at"):
        op.drop_column("payout_request", col, schema=SCHEMA)
