"""Receipt aggregate: 1..5 attachments + drop hard duplicate UNIQUE constraints.

One seller submission = one Receipt with 1..5 ``receipt_attachment`` rows (images /
PDFs, mixed). This migration:

1. creates ``vliq.attachment_kind_enum`` + ``vliq.receipt_attachment`` table;
2. backfills one attachment (position 0) for every existing *file-based* receipt
   (QR-only rows — ``qr://inline`` / ``file_kind='qr'`` — get **no** attachment but
   stay readable);
3. adds ``receipt.upload_idempotency_key`` (+ partial unique per seller) so a retried
   package finalize never creates a second Receipt;
4. makes the legacy ``file_url / file_hash / file_kind`` columns nullable (they become a
   convenience mirror of ``attachments[0]``);
5. drops the hard duplicate UNIQUE indexes (``uq_receipt_file_hash_active``,
   ``uq_receipt_qr_raw_active``, ``uq_receipt_fn_fd_fp``) and replaces them with
   **non-unique** partial indexes — a duplicate is now a fraud *signal* for the admin,
   never a hard 409 / insert failure. Search performance is preserved.

A follow-up cleanup migration may later drop the legacy single-file columns once all
readers consume ``attachments``.

Revision ID: 0005_receipt_attachments
Revises: 0004_city_table
Create Date: 2026-06-22 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PgEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import text

# revision identifiers, used by Alembic.
revision: str = "0005_receipt_attachments"
down_revision: str | None = "0004_city_table"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:
    # 1. Enum type (idempotent — same pattern as 0001).
    op.execute(
        "DO $$ BEGIN CREATE TYPE vliq.attachment_kind_enum AS ENUM ('image', 'pdf') "
        "; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )

    # 2. receipt_attachment table.
    op.create_table(
        "receipt_attachment",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "receipt_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.receipt.id", ondelete="CASCADE", name="receipt_attachment_receipt_id_fkey"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "kind",
            PgEnum("image", "pdf", name="attachment_kind_enum", schema=SCHEMA, create_type=False),
            nullable=False,
        ),
        sa.Column("mime_type", sa.String(127), nullable=False),
        sa.Column("storage_uri", sa.String(1000), nullable=False),
        sa.Column("file_hash", sa.String(128), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("extraction", JSONB(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="receipt_attachment_pkey"),
        sa.UniqueConstraint("receipt_id", "position", name="uq_receipt_attachment_receipt_position"),
        schema=SCHEMA,
    )
    op.create_index("vliq_receipt_attachment_receipt_id_idx", "receipt_attachment", ["receipt_id"], schema=SCHEMA)
    op.create_index("vliq_receipt_attachment_file_hash_idx", "receipt_attachment", ["file_hash"], schema=SCHEMA)

    # 3. Backfill one attachment (position 0) per existing file-based receipt.
    #    QR-only rows (qr://inline / file_kind='qr') are intentionally skipped.
    op.execute(
        f"""
        INSERT INTO {SCHEMA}.receipt_attachment
            (receipt_id, position, kind, mime_type, storage_uri, file_hash, size_bytes, created_at)
        SELECT
            r.id,
            0,
            (CASE WHEN r.file_kind = 'pdf' THEN 'pdf' ELSE 'image' END)::{SCHEMA}.attachment_kind_enum,
            CASE r.file_kind
                WHEN 'pdf' THEN 'application/pdf'
                WHEN 'screenshot' THEN 'image/png'
                ELSE 'image/jpeg'
            END,
            r.file_url,
            COALESCE(r.file_hash, ''),
            0,
            r.created_at
        FROM {SCHEMA}.receipt r
        WHERE r.file_url IS NOT NULL
          AND r.file_url NOT LIKE 'qr://%'
          AND (r.file_kind IS NULL OR r.file_kind <> 'qr')
        """
    )

    # 4. Idempotency key for package finalize.
    op.add_column("receipt", sa.Column("upload_idempotency_key", sa.String(64), nullable=True), schema=SCHEMA)
    op.create_index(
        "uq_receipt_idem_key",
        "receipt",
        ["seller_id", "upload_idempotency_key"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=text("upload_idempotency_key IS NOT NULL"),
    )

    # 5. Legacy single-file columns become nullable (mirror of attachments[0]).
    op.alter_column("receipt", "file_url", existing_type=sa.String(1000), nullable=True, schema=SCHEMA)
    op.alter_column("receipt", "file_hash", existing_type=sa.String(128), nullable=True, schema=SCHEMA)
    op.alter_column(
        "receipt",
        "file_kind",
        existing_type=PgEnum(name="receipt_file_kind_enum", schema=SCHEMA, create_type=False),
        nullable=True,
        schema=SCHEMA,
    )

    # 6. Replace hard duplicate UNIQUE indexes with non-unique partial indexes.
    op.drop_index("uq_receipt_file_hash_active", table_name="receipt", schema=SCHEMA)
    op.drop_index("uq_receipt_qr_raw_active", table_name="receipt", schema=SCHEMA)
    op.drop_index("uq_receipt_fn_fd_fp", table_name="receipt", schema=SCHEMA)

    op.create_index(
        "ix_receipt_file_hash_active",
        "receipt",
        ["file_hash"],
        schema=SCHEMA,
        postgresql_where=text("file_hash IS NOT NULL AND is_deleted = false"),
    )
    op.create_index(
        "ix_receipt_qr_raw_active",
        "receipt",
        ["qr_raw"],
        schema=SCHEMA,
        postgresql_where=text("qr_raw IS NOT NULL AND is_deleted = false"),
    )
    op.create_index(
        "ix_receipt_fn_fd_fp_active",
        "receipt",
        ["fn", "fd", "fp"],
        schema=SCHEMA,
        postgresql_where=text("fn IS NOT NULL AND is_deleted = false"),
    )


def downgrade() -> None:
    # Reverse the index swap.
    op.drop_index("ix_receipt_fn_fd_fp_active", table_name="receipt", schema=SCHEMA)
    op.drop_index("ix_receipt_qr_raw_active", table_name="receipt", schema=SCHEMA)
    op.drop_index("ix_receipt_file_hash_active", table_name="receipt", schema=SCHEMA)
    op.create_index(
        "uq_receipt_fn_fd_fp",
        "receipt",
        ["fn", "fd", "fp"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=text("fn IS NOT NULL AND is_deleted = false"),
    )
    op.create_index(
        "uq_receipt_qr_raw_active",
        "receipt",
        ["qr_raw"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=text("qr_raw IS NOT NULL AND is_deleted = false"),
    )
    op.create_index(
        "uq_receipt_file_hash_active",
        "receipt",
        ["file_hash"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=text("is_deleted = false"),
    )

    # Restore NOT NULL on legacy columns (best-effort — fails if nulls exist).
    op.alter_column(
        "receipt",
        "file_kind",
        existing_type=PgEnum(name="receipt_file_kind_enum", schema=SCHEMA, create_type=False),
        nullable=False,
        schema=SCHEMA,
    )
    op.alter_column("receipt", "file_hash", existing_type=sa.String(128), nullable=False, schema=SCHEMA)
    op.alter_column("receipt", "file_url", existing_type=sa.String(1000), nullable=False, schema=SCHEMA)

    op.drop_index("uq_receipt_idem_key", table_name="receipt", schema=SCHEMA)
    op.drop_column("receipt", "upload_idempotency_key", schema=SCHEMA)

    op.drop_index("vliq_receipt_attachment_file_hash_idx", table_name="receipt_attachment", schema=SCHEMA)
    op.drop_index("vliq_receipt_attachment_receipt_id_idx", table_name="receipt_attachment", schema=SCHEMA)
    op.drop_table("receipt_attachment", schema=SCHEMA)
    op.execute("DROP TYPE IF EXISTS vliq.attachment_kind_enum")
