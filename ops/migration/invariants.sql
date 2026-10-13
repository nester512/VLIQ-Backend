-- Checks AFTER migrations 0009–0014. Every line must end in "|0" (number of violations).
-- Aggregates only — no personal data.
--   psql -U vliq -d vliq -At -F '|' -f ops/migration/invariants.sql
\set ON_ERROR_STOP on

-- schema is at the head the code expects
SELECT 'alembic_version_not_0014', count(*) FROM public.alembic_version WHERE version_num <> '0014_backfill_paid_out';
-- CONCURRENTLY indexes: none left INVALID by an interrupted build
SELECT 'invalid_indexes', count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'vliq' AND NOT i.indisvalid;
-- 0009: every receipt has a verification status; old file receipts are «not required»
SELECT 'receipt_without_verification_status', count(*) FROM vliq.receipt WHERE verification_status IS NULL;
-- 0011: every receipt has a journey; the provider list is seeded
SELECT 'receipt_without_journey', count(*) FROM vliq.receipt r
  WHERE NOT EXISTS (SELECT 1 FROM vliq.receipt_event e WHERE e.receipt_id = r.id);
SELECT 'check_providers_not_5', abs(count(*) - 5) FROM vliq.check_provider;
-- 0012: decided payouts have their dates; coverage never exceeds a payout or a bonus
SELECT 'paid_payout_without_paid_at', count(*) FROM vliq.payout_request WHERE status = 'paid' AND paid_at IS NULL;
SELECT 'rejected_payout_without_rejected_at', count(*) FROM vliq.payout_request WHERE status = 'rejected' AND rejected_at IS NULL;
SELECT 'payout_covered_more_than_amount', count(*) FROM (
  SELECT p.id FROM vliq.payout_request p JOIN vliq.payout_receipt l ON l.payout_id = p.id
  GROUP BY p.id, p.amount HAVING sum(l.amount) > p.amount) x;
SELECT 'receipt_covered_more_than_bonus', count(*) FROM (
  SELECT r.id FROM vliq.receipt r JOIN vliq.payout_receipt l ON l.receipt_id = r.id
  JOIN vliq.payout_request p ON p.id = l.payout_id AND p.status <> 'rejected'
  GROUP BY r.id, r.bonus_amount HAVING sum(l.amount) > r.bonus_amount) x;
SELECT 'coverage_on_unapproved_receipt', count(*) FROM vliq.payout_receipt l JOIN vliq.receipt r ON r.id = l.receipt_id
  WHERE r.status NOT IN ('approved', 'paid_out') AND NOT r.is_deleted;
-- 0014: no approved receipt left that PAID payouts fully cover; every «Выплачен» is fully covered
SELECT 'approved_but_fully_paid', count(*) FROM (
  SELECT r.id FROM vliq.receipt r JOIN vliq.payout_receipt l ON l.receipt_id = r.id
  JOIN vliq.payout_request p ON p.id = l.payout_id AND p.status = 'paid'
  WHERE r.status = 'approved' AND NOT r.is_deleted
  GROUP BY r.id, r.bonus_amount HAVING sum(l.amount) >= r.bonus_amount) x;
SELECT 'paid_out_marked_by_0014_not_covered', count(*) FROM vliq.receipt r
  WHERE r.status = 'paid_out' AND EXISTS (SELECT 1 FROM vliq.receipt_event e WHERE e.receipt_id = r.id AND e.data->>'migration' = '0014')
  AND coalesce((SELECT sum(l.amount) FROM vliq.payout_receipt l JOIN vliq.payout_request p ON p.id = l.payout_id AND p.status = 'paid'
                WHERE l.receipt_id = r.id), 0) < r.bonus_amount;
-- 0013: nobody is cut off by the migration itself
SELECT 'seller_login_disabled_after_migration', count(*) FROM vliq.seller WHERE primary_login_disabled;
SELECT 'seller_login_rows_after_migration', count(*) FROM vliq.seller_login;
-- INFO (not a failure — the migration does not touch money, the fingerprint proves it): sellers whose
-- available balance is below zero — a debt after a cancelled paid receipt, or an old anomaly to look at.
SELECT 'info_negative_available_balance', count(*) FROM (
  SELECT seller_id FROM vliq.bonus_transaction WHERE kind <> 'payout_completed' GROUP BY seller_id HAVING sum(amount) < 0) x;
