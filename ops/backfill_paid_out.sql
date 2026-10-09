-- One-off: «Выплачен» on receipts already fully paid BEFORE migration 0012 (BRD В-8-A).
--
-- Migration 0012 rebuilt the payout ↔ receipt coverage of old payouts (FIFO) but left
-- receipt statuses alone — a mass status change on prod needs the owner's explicit «да».
-- New payouts mark their receipts themselves; this closes the history.
--
-- Run ONLY after `ops/deploy.sh` took its backup, and only with the owner's go-ahead:
--   docker compose exec -T postgres psql -U vliq -d vliq -v apply=0 < ops/backfill_paid_out.sql   -- dry run
--   docker compose exec -T postgres psql -U vliq -d vliq -v apply=1 < ops/backfill_paid_out.sql   -- apply
--
-- Idempotent: only `approved` receipts whose bonus is fully covered by PAID payouts
-- change; each gets one `paid_out` journey event marked `backfilled`. Ledger untouched.

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE fully_paid ON COMMIT DROP AS
SELECT r.id AS receipt_id, max(p.id) AS payout_id, sum(l.amount) AS paid, max(coalesce(p.paid_at, p.updated_at)) AS paid_at
FROM vliq.receipt r
JOIN vliq.payout_receipt l ON l.receipt_id = r.id
JOIN vliq.payout_request p ON p.id = l.payout_id AND p.status = 'paid'
WHERE r.status = 'approved' AND r.is_deleted = false
GROUP BY r.id, r.bonus_amount
HAVING sum(l.amount) >= r.bonus_amount;

SELECT count(*) AS receipts_to_mark_paid_out, coalesce(sum(paid), 0) AS kopecks FROM fully_paid;

UPDATE vliq.receipt r SET status = 'paid_out'
FROM fully_paid f WHERE r.id = f.receipt_id AND r.status = 'approved';

INSERT INTO vliq.receipt_event (receipt_id, seq, at, kind, actor_type, data)
SELECT f.receipt_id,
       coalesce((SELECT max(e.seq) FROM vliq.receipt_event e WHERE e.receipt_id = f.receipt_id), 0) + 1,
       f.paid_at, 'paid_out', 'system',
       jsonb_build_object('payout_id', f.payout_id, 'amount', f.paid, 'partial', false, 'backfilled', true)
FROM fully_paid f;

\if :apply
COMMIT;
\echo 'APPLIED'
\else
ROLLBACK;
\echo 'DRY RUN — nothing changed (pass -v apply=1 to apply)'
\endif
