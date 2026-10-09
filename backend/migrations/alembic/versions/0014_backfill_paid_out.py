"""«Выплачен» on receipts already paid before the payout ↔ receipt link existed (BRD В-8-A).

Owner decision 2026-10-09: the history is closed BY THE MIGRATION on rollout (not only
by the manual ops/backfill_paid_out.sql). 0012 rebuilt the coverage of old payouts
(``payout_receipt``, FIFO); here every ``approved`` live receipt whose bonus is fully
covered by PAID payouts becomes ``paid_out`` and gets one ``paid_out`` journey event
marked ``{"backfilled": true, "migration": "0014"}``.

PRODUCTION SAFETY (CLAUDE.md «Безопасность данных при деплое»):
- the only rows changed are receipt.status approved → paid_out, exactly the set above;
  bonuses, ledger and payouts are untouched; ops/deploy.sh takes a verified dump first;
- idempotent: a re-run finds nothing (the receipts are no longer ``approved``);
- reversible: downgrade puts back ``approved`` on exactly the receipts this migration
  marked (found by their 0014 journey event) and removes those events.

Revision ID: 0014_backfill_paid_out
Revises: 0013_seller_login
Create Date: 2026-10-09 00:00:00.000000
"""
from __future__ import annotations

from alembic import op

revision: str = "0014_backfill_paid_out"
down_revision: str | None = "0013_seller_login"
branch_labels: str | None = None
depends_on: str | None = None

SCHEMA = "vliq"
MARK = "0014"

FULLY_PAID = f"""
    SELECT r.id AS receipt_id, max(p.id) AS payout_id, sum(l.amount) AS paid,
           max(coalesce(p.paid_at, p.updated_at)) AS paid_at
    FROM {SCHEMA}.receipt r
    JOIN {SCHEMA}.payout_receipt l ON l.receipt_id = r.id
    JOIN {SCHEMA}.payout_request p ON p.id = l.payout_id AND p.status = 'paid'
    WHERE r.status = 'approved' AND r.is_deleted = false AND r.bonus_amount > 0
    GROUP BY r.id, r.bonus_amount
    HAVING sum(l.amount) >= r.bonus_amount
"""

UPGRADE = f"""
WITH fully_paid AS ({FULLY_PAID}),
events AS (
    INSERT INTO {SCHEMA}.receipt_event (receipt_id, seq, at, kind, actor_type, data)
    SELECT f.receipt_id,
           coalesce((SELECT max(e.seq) FROM {SCHEMA}.receipt_event e WHERE e.receipt_id = f.receipt_id), 0) + 1,
           f.paid_at, 'paid_out', 'system',
           jsonb_build_object('payout_id', f.payout_id, 'amount', f.paid, 'partial', false,
                              'backfilled', true, 'migration', '{MARK}')
    FROM fully_paid f
    RETURNING receipt_id
)
UPDATE {SCHEMA}.receipt r SET status = 'paid_out'
FROM events WHERE r.id = events.receipt_id AND r.status = 'approved'
"""

DOWNGRADE = f"""
WITH marked AS (
    DELETE FROM {SCHEMA}.receipt_event
    WHERE kind = 'paid_out' AND data ->> 'migration' = '{MARK}'
    RETURNING receipt_id
)
UPDATE {SCHEMA}.receipt r SET status = 'approved'
FROM marked WHERE r.id = marked.receipt_id AND r.status = 'paid_out'
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
