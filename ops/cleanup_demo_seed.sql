-- One-off cleanup of demo seed rows on a LIVE database (prod / test stand).
--
-- Context: until the SEED_DEMO split, backend/seed_dev.sql re-created demo
-- sellers and seed:// receipts on every backend start. After deploying the
-- split (seed_demo.sql behind SEED_DEMO, default off) run this once to remove
-- the rows that were already seeded:
--
--   docker compose exec -T postgres psql -U vliq -d vliq < ops/cleanup_demo_seed.sql
--
-- Scope: ONLY the six demo seller ids and the three demo promotions from
-- seed_demo.sql. Real sellers, admins, the brand and the city dictionary are
-- untouched. Child rows (receipts, attachments, bonus transactions, payout
-- requests, notifications) are removed via ON DELETE CASCADE.

BEGIN;

DELETE FROM vliq.notification_outbox
WHERE recipient_id IN (12345, 10000001, 10000002, 10000003, 10000004, 10000005);

DELETE FROM vliq.seller
WHERE telegram_id IN (12345, 10000001, 10000002, 10000003, 10000004, 10000005);

DELETE FROM vliq.promotion
WHERE brand_id = 1
  AND name IN ('SWONQ — двойной бонус', 'Новая линейка +400 ₽', 'Первые 10 чеков');

COMMIT;
