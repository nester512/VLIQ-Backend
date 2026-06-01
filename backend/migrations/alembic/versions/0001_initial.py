"""Initial schema — all 10 tables with enums, constraints, and indexes.

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-24 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import ENUM as PgEnum, JSONB

# revision identifiers, used by Alembic.
revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"


def upgrade() -> None:  # noqa: PLR0915
    # ------------------------------------------------------------------ schema
    op.execute("CREATE SCHEMA IF NOT EXISTS vliq")

    # ------------------------------------------------------------------ enums
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.admin_role_enum AS ENUM ('admin', 'super_admin')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.seller_status_enum AS ENUM ('active', 'pending', 'blocked')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.payout_kind_enum AS ENUM ('card', 'sbp_phone', 'sbp_bank')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.receipt_status_enum AS ENUM "
        "('pending', 'ocr_in_progress', 'on_review', 'approved', 'rejected', 'needs_revision', 'paid_out')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.receipt_file_kind_enum AS ENUM ('photo', 'pdf', 'qr', 'screenshot')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.promotion_status_enum AS ENUM ('draft', 'active', 'paused', 'finished')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.bonus_transaction_kind_enum AS ENUM "
        "('accrual_receipt', 'accrual_promo', 'accrual_manual', "
        "'payout_hold', 'payout_completed', 'payout_reverted', 'correction')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.payout_request_status_enum AS ENUM ('new', 'in_progress', 'paid', 'rejected')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.notification_type_enum AS ENUM "
        "('receipt_approved', 'receipt_rejected', 'bonus_accrued', "
        "'payout_sent', 'promo_started', 'promo_ending')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.notification_delivery_status_enum AS ENUM "
        "('queued', 'sent', 'delivered', 'failed')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN " "CREATE TYPE vliq.audit_log_actor_type_enum AS ENUM ('seller', 'admin', 'system')" " ; EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )

    # ------------------------------------------------------------------ brand
    op.create_table(
        "brand",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("slug", sa.String(255), nullable=False),
        sa.Column("settings", JSONB(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="brand_pkey"),
        sa.UniqueConstraint("slug", name="brand_slug_key"),
        schema=SCHEMA,
    )
    op.create_index("vliq_brand_slug_idx", "brand", ["slug"], schema=SCHEMA)
    op.create_index("vliq_brand_is_active_idx", "brand", ["is_active"], schema=SCHEMA)

    # ------------------------------------------------------------------ admin
    op.create_table(
        "admin",
        sa.Column("telegram_id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("phone_e164", sa.String(32), nullable=False),
        sa.Column("first_name", sa.String(255), nullable=True),
        sa.Column("last_name", sa.String(255), nullable=True),
        sa.Column(
            "role",
            PgEnum("admin", "super_admin", name="admin_role_enum", schema=SCHEMA, create_type=False),
            nullable=False,
            server_default="admin",
        ),
        sa.Column("brand_ids", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("telegram_id", name="admin_pkey"),
        sa.UniqueConstraint("phone_e164", name="admin_phone_e164_key"),
        schema=SCHEMA,
    )
    op.create_index("vliq_admin_role_idx", "admin", ["role"], schema=SCHEMA)
    op.create_index("vliq_admin_is_active_idx", "admin", ["is_active"], schema=SCHEMA)

    # ------------------------------------------------------------------ seller
    op.create_table(
        "seller",
        sa.Column("telegram_id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column(
            "brand_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.brand.id", ondelete="RESTRICT", name="seller_brand_id_fkey"),
            nullable=False,
        ),
        sa.Column("phone_e164", sa.String(32), nullable=False),
        sa.Column("first_name", sa.String(255), nullable=True),
        sa.Column("last_name", sa.String(255), nullable=True),
        sa.Column("city", sa.String(255), nullable=True),
        sa.Column("region", sa.String(255), nullable=True),
        sa.Column("outlet_name", sa.String(255), nullable=True),
        sa.Column("outlet_address", sa.String(255), nullable=True),
        sa.Column("outlet_chain", sa.String(255), nullable=True),
        sa.Column("outlet_inn", sa.String(32), nullable=True),
        sa.Column("position", sa.String(255), nullable=True),
        sa.Column(
            "status",
            PgEnum("active", "pending", "blocked", name="seller_status_enum", schema=SCHEMA, create_type=False),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("block_reason", sa.Text(), nullable=True),
        sa.Column(
            "payout_kind",
            PgEnum("card", "sbp_phone", "sbp_bank", name="payout_kind_enum", schema=SCHEMA, create_type=False),
            nullable=True,
        ),
        sa.Column("payout_masked", sa.String(64), nullable=True),
        sa.Column("payout_encrypted", sa.Text(), nullable=True),
        sa.Column("consent_pdn_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("telegram_id", name="seller_pkey"),
        sa.UniqueConstraint("phone_e164", name="seller_phone_e164_key"),
        schema=SCHEMA,
    )
    op.create_index("vliq_seller_brand_id_idx", "seller", ["brand_id"], schema=SCHEMA)
    op.create_index("vliq_seller_phone_e164_idx", "seller", ["phone_e164"], schema=SCHEMA)
    op.create_index("vliq_seller_status_idx", "seller", ["status"], schema=SCHEMA)
    # H8: composite hot-path index
    op.create_index(
        "ix_seller_brand_status",
        "seller",
        ["brand_id", "status"],
        schema=SCHEMA,
    )

    # ------------------------------------------------------------------ sku
    op.create_table(
        "sku",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "brand_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.brand.id", ondelete="CASCADE", name="sku_brand_id_fkey"),
            nullable=False,
        ),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(128), nullable=True),
        sa.Column("default_bonus", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("aliases", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="sku_pkey"),
        sa.UniqueConstraint("code", name="sku_code_key"),
        schema=SCHEMA,
    )
    op.create_index("vliq_sku_brand_id_idx", "sku", ["brand_id"], schema=SCHEMA)
    op.create_index("vliq_sku_code_idx", "sku", ["code"], schema=SCHEMA)
    op.create_index("vliq_sku_is_active_idx", "sku", ["is_active"], schema=SCHEMA)
    # H9: GIN index for OCR alias matching
    op.create_index(
        "ix_sku_aliases_gin",
        "sku",
        ["aliases"],
        schema=SCHEMA,
        postgresql_using="gin",
    )

    # ------------------------------------------------------------------ promotion
    op.create_table(
        "promotion",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "brand_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.brand.id", ondelete="CASCADE", name="promotion_brand_id_fkey"),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("tag", sa.String(64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("starts_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("ends_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column(
            "status",
            PgEnum(
                "draft", "active", "paused", "finished",
                name="promotion_status_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rules", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("scope_cities", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("scope_outlets", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("scope_skus", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("per_user_per_day", sa.Integer(), nullable=True),
        sa.Column("per_user_total", sa.Integer(), nullable=True),
        sa.Column("total_budget", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="promotion_pkey"),
        schema=SCHEMA,
    )
    op.create_index("vliq_promotion_brand_id_idx", "promotion", ["brand_id"], schema=SCHEMA)
    op.create_index("vliq_promotion_tag_idx", "promotion", ["tag"], schema=SCHEMA)
    op.create_index("vliq_promotion_status_idx", "promotion", ["status"], schema=SCHEMA)
    # H8: composite hot-path index
    op.create_index(
        "ix_promotion_brand_status",
        "promotion",
        ["brand_id", "status"],
        schema=SCHEMA,
    )

    # ------------------------------------------------------------------ receipt
    op.create_table(
        "receipt",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "seller_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.seller.telegram_id", ondelete="CASCADE", name="receipt_seller_id_fkey"),
            nullable=False,
        ),
        sa.Column(
            "brand_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.brand.id", ondelete="RESTRICT", name="receipt_brand_id_fkey"),
            nullable=False,
        ),
        sa.Column(
            "status",
            PgEnum(
                "pending", "on_review", "approved", "rejected", "needs_revision", "paid_out",
                name="receipt_status_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("bonus_amount", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column(
            "file_kind",
            PgEnum(
                "photo", "pdf", "qr", "screenshot",
                name="receipt_file_kind_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("file_url", sa.String(1000), nullable=False),
        # B8: no global unique — partial unique index WHERE is_deleted = false (see below)
        sa.Column("file_hash", sa.String(128), nullable=False),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("total_sum", sa.Integer(), nullable=True),
        sa.Column("shop_name", sa.String(255), nullable=True),
        sa.Column("shop_inn", sa.String(32), nullable=True),
        # B8: no global unique — partial unique index WHERE is_deleted = false (see below)
        sa.Column("qr_raw", sa.String(1000), nullable=True),
        sa.Column("fn", sa.String(64), nullable=True),
        sa.Column("fd", sa.String(64), nullable=True),
        sa.Column("fp", sa.String(64), nullable=True),
        sa.Column("ocr_confidence", sa.Float(), nullable=True),
        sa.Column("ocr_raw", JSONB(), nullable=True),
        sa.Column("items", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("fraud_signals", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="receipt_pkey"),
        schema=SCHEMA,
    )
    op.create_index("vliq_receipt_seller_id_idx", "receipt", ["seller_id"], schema=SCHEMA)
    op.create_index("vliq_receipt_brand_id_idx", "receipt", ["brand_id"], schema=SCHEMA)
    op.create_index("vliq_receipt_status_idx", "receipt", ["status"], schema=SCHEMA)
    op.create_index("vliq_receipt_is_deleted_idx", "receipt", ["is_deleted"], schema=SCHEMA)

    # B8: partial UNIQUE on file_hash — soft-delete safe
    op.create_index(
        "uq_receipt_file_hash_active",
        "receipt",
        ["file_hash"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=text("is_deleted = false"),
    )
    # B8: partial UNIQUE on qr_raw — soft-delete safe
    op.create_index(
        "uq_receipt_qr_raw_active",
        "receipt",
        ["qr_raw"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=text("qr_raw IS NOT NULL AND is_deleted = false"),
    )
    # B7: partial composite UNIQUE on (fn, fd, fp) — main anti-fraud constraint
    op.create_index(
        "uq_receipt_fn_fd_fp",
        "receipt",
        ["fn", "fd", "fp"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=text("fn IS NOT NULL AND is_deleted = false"),
    )
    # H8: hot-path composite index
    op.create_index(
        "ix_receipt_brand_status_created",
        "receipt",
        ["brand_id", "status", "created_at"],
        schema=SCHEMA,
    )
    # H9: GIN indexes for JSONB fields
    op.create_index(
        "ix_receipt_items_gin",
        "receipt",
        ["items"],
        schema=SCHEMA,
        postgresql_using="gin",
    )
    op.create_index(
        "ix_receipt_fraud_signals_gin",
        "receipt",
        ["fraud_signals"],
        schema=SCHEMA,
        postgresql_using="gin",
    )

    # ------------------------------------------------------------------ bonus_transaction
    op.create_table(
        "bonus_transaction",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "seller_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.seller.telegram_id", ondelete="CASCADE", name="bonus_transaction_seller_id_fkey"),
            nullable=False,
        ),
        sa.Column(
            "brand_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.brand.id", ondelete="RESTRICT", name="bonus_transaction_brand_id_fkey"),
            nullable=False,
        ),
        sa.Column(
            "amount",
            sa.Integer(),
            nullable=False,
            comment="Signed amount in bonus units (positive=accrual, negative=spend)",
        ),
        sa.Column(
            "kind",
            PgEnum(
                "accrual_receipt", "accrual_promo", "accrual_manual",
                "payout_hold", "payout_completed", "payout_reverted", "correction",
                name="bonus_transaction_kind_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("source_type", sa.String(32), nullable=False, comment="receipt | payout | admin"),
        sa.Column("source_id", sa.BigInteger(), nullable=True, comment="Polymorphic — no FK"),
        sa.Column(
            "promotion_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.promotion.id", ondelete="SET NULL", name="bonus_transaction_promotion_id_fkey"),
            nullable=True,
        ),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="bonus_transaction_pkey"),
        schema=SCHEMA,
    )
    op.create_index("vliq_bonus_transaction_seller_id_idx", "bonus_transaction", ["seller_id"], schema=SCHEMA)
    op.create_index("vliq_bonus_transaction_brand_id_idx", "bonus_transaction", ["brand_id"], schema=SCHEMA)
    op.create_index("vliq_bonus_transaction_kind_idx", "bonus_transaction", ["kind"], schema=SCHEMA)
    op.create_index("vliq_bonus_transaction_promotion_id_idx", "bonus_transaction", ["promotion_id"], schema=SCHEMA)
    # H8: hot-path composite index
    op.create_index(
        "ix_bonus_tx_seller_brand_created",
        "bonus_transaction",
        ["seller_id", "brand_id", "created_at"],
        schema=SCHEMA,
    )

    # ------------------------------------------------------------------ payout_request
    op.create_table(
        "payout_request",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "seller_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.seller.telegram_id", ondelete="CASCADE", name="payout_request_seller_id_fkey"),
            nullable=False,
        ),
        sa.Column(
            "brand_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.brand.id", ondelete="RESTRICT", name="payout_request_brand_id_fkey"),
            nullable=False,
        ),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column(
            "payout_kind",
            PgEnum(
                "card", "sbp_phone", "sbp_bank",
                name="payout_kind_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "payout_masked",
            sa.String(64),
            nullable=False,
            comment="Snapshot of payout destination at the time of request",
        ),
        sa.Column(
            "status",
            PgEnum(
                "new", "in_progress", "paid", "rejected",
                name="payout_request_status_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
            server_default="new",
        ),
        sa.Column("admin_comment", sa.Text(), nullable=True),
        sa.Column("external_txn_id", sa.String(128), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="payout_request_pkey"),
        schema=SCHEMA,
    )
    op.create_index("vliq_payout_request_seller_id_idx", "payout_request", ["seller_id"], schema=SCHEMA)
    op.create_index("vliq_payout_request_brand_id_idx", "payout_request", ["brand_id"], schema=SCHEMA)
    op.create_index("vliq_payout_request_status_idx", "payout_request", ["status"], schema=SCHEMA)
    op.create_index("vliq_payout_request_external_txn_id_idx", "payout_request", ["external_txn_id"], schema=SCHEMA)
    # H8: hot-path composite index
    op.create_index(
        "ix_payout_seller_status",
        "payout_request",
        ["seller_id", "status"],
        schema=SCHEMA,
    )

    # ------------------------------------------------------------------ notification
    op.create_table(
        "notification",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "seller_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.seller.telegram_id", ondelete="CASCADE", name="notification_seller_id_fkey"),
            nullable=False,
        ),
        sa.Column(
            "type",
            PgEnum(
                "receipt_approved", "receipt_rejected", "bonus_accrued",
                "payout_sent", "promo_started", "promo_ending",
                name="notification_type_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
        ),
        sa.Column("payload", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("telegram_message_id", sa.BigInteger(), nullable=True),
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("read_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "delivery_status",
            PgEnum(
                "queued", "sent", "delivered", "failed",
                name="notification_delivery_status_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
            server_default="queued",
        ),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="notification_pkey"),
        schema=SCHEMA,
    )
    op.create_index("vliq_notification_seller_id_idx", "notification", ["seller_id"], schema=SCHEMA)
    op.create_index("vliq_notification_type_idx", "notification", ["type"], schema=SCHEMA)
    op.create_index("vliq_notification_delivery_status_idx", "notification", ["delivery_status"], schema=SCHEMA)

    # ------------------------------------------------------------------ audit_log
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("actor_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "actor_type",
            PgEnum(
                "seller", "admin", "system",
                name="audit_log_actor_type_enum", schema=SCHEMA, create_type=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "action",
            sa.String(64),
            nullable=False,
            comment="e.g. approve_receipt | reject_receipt | edit_bonus | comment | block_seller | approve_payout",
        ),
        sa.Column(
            "entity_type",
            sa.String(32),
            nullable=False,
            comment="e.g. receipt | payout | seller | promotion",
        ),
        sa.Column("entity_id", sa.BigInteger(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("payload", JSONB(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="audit_log_pkey"),
        schema=SCHEMA,
    )
    op.create_index("vliq_audit_log_actor_id_idx", "audit_log", ["actor_id"], schema=SCHEMA)
    op.create_index("vliq_audit_log_actor_type_idx", "audit_log", ["actor_type"], schema=SCHEMA)
    op.create_index("vliq_audit_log_action_idx", "audit_log", ["action"], schema=SCHEMA)
    op.create_index("vliq_audit_log_entity_id_idx", "audit_log", ["entity_id"], schema=SCHEMA)
    # H10: composite indexes for audit queries
    op.create_index(
        "ix_audit_actor_created",
        "audit_log",
        ["actor_id", "actor_type", "created_at"],
        schema=SCHEMA,
    )
    op.create_index(
        "ix_audit_entity",
        "audit_log",
        ["entity_type", "entity_id"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    # Drop tables in reverse dependency order.
    op.drop_table("audit_log", schema=SCHEMA)
    op.drop_table("notification", schema=SCHEMA)
    op.drop_table("payout_request", schema=SCHEMA)
    op.drop_table("bonus_transaction", schema=SCHEMA)
    op.drop_table("receipt", schema=SCHEMA)
    op.drop_table("promotion", schema=SCHEMA)
    op.drop_table("sku", schema=SCHEMA)
    op.drop_table("seller", schema=SCHEMA)
    op.drop_table("admin", schema=SCHEMA)
    op.drop_table("brand", schema=SCHEMA)

    # Drop enums.
    op.execute("DROP TYPE IF EXISTS vliq.audit_log_actor_type_enum")
    op.execute("DROP TYPE IF EXISTS vliq.notification_delivery_status_enum")
    op.execute("DROP TYPE IF EXISTS vliq.notification_type_enum")
    op.execute("DROP TYPE IF EXISTS vliq.payout_request_status_enum")
    op.execute("DROP TYPE IF EXISTS vliq.bonus_transaction_kind_enum")
    op.execute("DROP TYPE IF EXISTS vliq.promotion_status_enum")
    op.execute("DROP TYPE IF EXISTS vliq.receipt_file_kind_enum")
    op.execute("DROP TYPE IF EXISTS vliq.receipt_status_enum")
    op.execute("DROP TYPE IF EXISTS vliq.payout_kind_enum")
    op.execute("DROP TYPE IF EXISTS vliq.seller_status_enum")
    op.execute("DROP TYPE IF EXISTS vliq.admin_role_enum")

    op.execute("DROP SCHEMA IF EXISTS vliq CASCADE")
