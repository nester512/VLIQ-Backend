"""QR intake: receipt source + automatic OFD verification with attempt history.

Receipts are now submitted as dry fiscal data (the QR contents) instead of files
(docs/design/RECEIPT-JOURNEY.md). Each receipt gets an automatic OFD check whose every
attempt is stored; a cron retries failed checks with other methods.

Additive and backward-compatible: existing receipts get
``verification_status='not_required'`` and keep working unchanged.

Also: a lease column so only one attempt runs at a time, and a failure counter
that provider-side refusals (rate limit, blocked token) do not spend.

Revision ID: 0009_qr_intake
Revises: 0008_seller_outlet_count
Create Date: 2026-10-08 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_qr_intake"
down_revision: str | None = "0008_seller_outlet_count"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    op.add_column("receipt", sa.Column("source", sa.String(32), nullable=True), schema=SCHEMA)
    op.add_column(
        "receipt",
        sa.Column("verification_status", sa.String(16), nullable=False, server_default="not_required"),
        schema=SCHEMA,
    )
    op.add_column(
        "receipt", sa.Column("verification_attempts", sa.Integer(), nullable=False, server_default="0"), schema=SCHEMA
    )
    op.add_column(
        "receipt", sa.Column("next_verification_at", sa.TIMESTAMP(timezone=True), nullable=True), schema=SCHEMA
    )
    op.add_column("receipt", sa.Column("verified_at", sa.TIMESTAMP(timezone=True), nullable=True), schema=SCHEMA)
    op.add_column("receipt", sa.Column("ofd_response", postgresql.JSONB(), nullable=True), schema=SCHEMA)
    # Failed attempts that count toward the retry budget (provider-side limits/blocks don't).
    op.add_column(
        "receipt", sa.Column("verification_failures", sa.Integer(), nullable=False, server_default="0"), schema=SCHEMA
    )
    # Lease while an attempt is in flight — separate from the retry schedule, so a
    # forced admin check and the cron never run the same receipt concurrently.
    op.add_column(
        "receipt", sa.Column("verification_locked_until", sa.TIMESTAMP(timezone=True), nullable=True), schema=SCHEMA
    )
    # The retry cron scans only due checks — keep that scan tiny on a large table.
    op.create_index(
        "ix_receipt_verification_due",
        "receipt",
        ["next_verification_at"],
        schema=SCHEMA,
        postgresql_where=sa.text("verification_status IN ('pending', 'retrying')"),
    )
    # Exact fiscal-identity lookups (duplicate warning at intake) reuse the existing
    # non-unique ix_receipt_fn_fd_fp_active (0005) — duplicates stay a signal (BRD В-3-A).

    op.create_table(
        "receipt_verification_attempt",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "receipt_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.receipt.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt_no", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("method", sa.String(32), nullable=False),
        sa.Column("trigger", sa.String(16), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("http_status", sa.Integer(), nullable=True),
        sa.Column("request", postgresql.JSONB(), nullable=True),
        sa.Column("response", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("receipt_id", "attempt_no", name="uq_receipt_verification_attempt_no"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_receipt_verification_attempt_receipt_id", "receipt_verification_attempt", ["receipt_id"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_index(
        "ix_receipt_verification_attempt_receipt_id", table_name="receipt_verification_attempt", schema=SCHEMA
    )
    op.drop_table("receipt_verification_attempt", schema=SCHEMA)
    op.drop_index("ix_receipt_verification_due", table_name="receipt", schema=SCHEMA)
    for col in ("verification_locked_until", "verification_failures", "ofd_response", "verified_at", "next_verification_at", "verification_attempts", "verification_status", "source"):
        op.drop_column("receipt", col, schema=SCHEMA)
