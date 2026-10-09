"""Receipt journey: one append-only event log per receipt + check-provider registry.

docs/design/RECEIPT-JOURNEY.md. Every step of a receipt — received, validated,
risk flags, each call to a check provider, verified / not, the admin decision,
bonus edits, comments, deletion, payout — becomes a ``receipt_event`` row
(``seq`` = order within the receipt), written in the same transaction as the
change itself. ``receipt_verification_attempt`` stays the per-provider call
record (exact request + raw response), now with round / role / adapter version.

PRODUCTION SAFETY (CLAUDE.md «Безопасность данных при деплое»):
- additive only: two new tables, nullable columns, no rewrite of existing rows;
- the backfill INSERTs journey events for receipts that have none (idempotent:
  a re-run inserts nothing), marked ``data.backfilled = true``; it reads
  receipt / verification attempts / audit_log and never modifies them.

Revision ID: 0011_receipt_journey
Revises: 0010_hot_path_indexes
Create Date: 2026-10-09 00:00:00.000000
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0011_receipt_journey"
down_revision: str | None = "0010_hot_path_indexes"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"

# Default registry (docs: owner decision 2026-10-09 — ФНС first; others plug in as
# access appears). `enabled` is the owner's switch; a provider is actually called
# only if this deployment also has its adapter configured (credentials).
PROVIDERS = [
    # code, title, role, priority
    ("fns", "ФНС «Проверка чеков»", "main", 10),
    ("proverkacheka", "proverkacheka.com", "main", 20),
    ("platformaofd", "Платформа ОФД", "fallback", 30),
    ("taxcom", "Такском ОФД", "fallback", 40),
    ("fake", "Заглушка (только стенд/dev)", "fallback", 90),
]

BACKFILL = f"""
WITH targets AS (
    SELECT r.* FROM {SCHEMA}.receipt r
    WHERE NOT EXISTS (SELECT 1 FROM {SCHEMA}.receipt_event e WHERE e.receipt_id = r.id)
),
ev AS (
    -- received
    SELECT t.id AS receipt_id, t.created_at AS at, 1 AS ord, 'received' AS kind,
           'seller' AS actor_type, t.seller_id AS actor_id, COALESCE(t.source, 'upload') AS source,
           NULL::varchar AS outcome, NULL::bigint AS check_id, '{{"backfilled": true}}'::jsonb AS data
    FROM targets t
    UNION ALL
    -- every recorded call to a check provider
    SELECT a.receipt_id, a.created_at, 2, 'provider_checked',
           CASE a.trigger WHEN 'admin' THEN 'admin' ELSE 'system' END, NULL, a.provider,
           a.outcome, a.id, jsonb_build_object('backfilled', true, 'method', a.method, 'trigger', a.trigger)
    FROM {SCHEMA}.receipt_verification_attempt a JOIN targets t ON t.id = a.receipt_id
    UNION ALL
    -- verified
    SELECT t.id, t.verified_at, 3, 'verified', 'system', NULL,
           (SELECT a.provider FROM {SCHEMA}.receipt_verification_attempt a
             WHERE a.receipt_id = t.id AND a.outcome = 'ok' ORDER BY a.attempt_no LIMIT 1),
           'ok', NULL, '{{"backfilled": true}}'::jsonb
    FROM targets t WHERE t.verified_at IS NOT NULL
    UNION ALL
    -- admin actions recorded in audit_log
    SELECT l.entity_id, l.created_at, 4,
           CASE l.action WHEN 'approve_receipt' THEN 'approved' WHEN 'reject_receipt' THEN 'rejected'
                         WHEN 'revise_receipt' THEN 'sent_to_revision' WHEN 'edit_bonus' THEN 'bonus_changed'
                         ELSE 'comment_added' END,
           'admin', l.actor_id, NULL, NULL, NULL,
           jsonb_strip_nulls(jsonb_build_object('backfilled', true, 'comment', l.comment, 'payload', l.payload))
    FROM {SCHEMA}.audit_log l JOIN targets t ON t.id = l.entity_id
    WHERE l.entity_type = 'receipt'
      AND l.action IN ('approve_receipt', 'reject_receipt', 'revise_receipt', 'edit_bonus', 'comment')
    UNION ALL
    -- a decided receipt without an audit trail (seeded / pre-audit data): inferred decision
    SELECT t.id, COALESCE(t.updated_at, t.created_at), 5,
           CASE t.status WHEN 'rejected' THEN 'rejected' ELSE 'approved' END,
           'system', NULL, NULL, NULL, NULL, '{{"backfilled": true, "inferred": true}}'::jsonb
    FROM targets t
    WHERE t.status IN ('approved', 'rejected', 'paid_out')
      AND NOT EXISTS (SELECT 1 FROM {SCHEMA}.audit_log l WHERE l.entity_type = 'receipt' AND l.entity_id = t.id
                        AND l.action IN ('approve_receipt', 'reject_receipt', 'revise_receipt'))
    UNION ALL
    SELECT t.id, COALESCE(t.updated_at, t.created_at), 6, 'paid_out', 'system', NULL, NULL, NULL, NULL,
           '{{"backfilled": true, "inferred": true}}'::jsonb
    FROM targets t WHERE t.status = 'paid_out'
    UNION ALL
    SELECT t.id, COALESCE(t.updated_at, t.created_at), 7, 'deleted', 'admin', t.updated_by, NULL, NULL, NULL,
           '{{"backfilled": true}}'::jsonb
    FROM targets t WHERE t.is_deleted
)
INSERT INTO {SCHEMA}.receipt_event (receipt_id, seq, at, kind, actor_type, actor_id, source, outcome, check_id, data)
SELECT receipt_id, row_number() OVER (PARTITION BY receipt_id ORDER BY at, ord), at, kind, actor_type, actor_id,
       source, outcome, check_id, data
FROM ev
"""


def upgrade() -> None:
    op.create_table(
        "check_provider",
        sa.Column("code", sa.String(32), primary_key=True),
        sa.Column("title", sa.String(128), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),  # main | fallback
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        # circuit breaker: a provider failing again and again is skipped for a while
        sa.Column("consecutive_failures", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("disabled_until", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        schema=SCHEMA,
    )
    op.execute(
        f"INSERT INTO {SCHEMA}.check_provider (code, title, role, priority) VALUES "
        + ", ".join(f"('{c}', '{t}', '{r}', {p})" for c, t, r, p in PROVIDERS)
        + " ON CONFLICT (code) DO NOTHING"
    )

    for name, col in (
        ("round_no", sa.Column("round_no", sa.Integer(), nullable=True)),
        ("provider_role", sa.Column("provider_role", sa.String(16), nullable=True)),
        ("adapter_version", sa.Column("adapter_version", sa.String(16), nullable=True)),
        ("parsed", sa.Column("parsed", postgresql.JSONB(), nullable=True)),
    ):
        op.add_column("receipt_verification_attempt", col, schema=SCHEMA)
        del name
    op.add_column("receipt", sa.Column("verified_by", sa.String(32), nullable=True), schema=SCHEMA)
    op.add_column("receipt", sa.Column("check_rounds", sa.Integer(), nullable=False, server_default="0"), schema=SCHEMA)

    op.create_table(
        "receipt_event",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("receipt_id", sa.BigInteger(), sa.ForeignKey(f"{SCHEMA}.receipt.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("actor_type", sa.String(16), nullable=False),  # seller | system | admin
        sa.Column("actor_id", sa.BigInteger(), nullable=True),
        sa.Column("source", sa.String(32), nullable=True),  # intake source or check provider
        sa.Column("outcome", sa.String(16), nullable=True),
        sa.Column(
            "check_id", sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.receipt_verification_attempt.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("data", postgresql.JSONB(), nullable=True),
        sa.UniqueConstraint("receipt_id", "seq", name="uq_receipt_event_seq"),
        schema=SCHEMA,
    )
    op.execute(BACKFILL)


def downgrade() -> None:
    op.drop_table("receipt_event", schema=SCHEMA)
    op.drop_column("receipt", "check_rounds", schema=SCHEMA)
    op.drop_column("receipt", "verified_by", schema=SCHEMA)
    for col in ("parsed", "adapter_version", "provider_role", "round_no"):
        op.drop_column("receipt_verification_attempt", col, schema=SCHEMA)
    op.drop_table("check_provider", schema=SCHEMA)
