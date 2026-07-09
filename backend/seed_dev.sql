-- Bootstrap seed for every backend start (idempotent).
-- Seeds ONLY the rows the app needs to be usable: the default brand and the
-- admin accounts. No demo sellers / receipts / bonuses / payouts / promotions /
-- notifications are created here — those were removed on purpose so the DB stays
-- clean. The city dictionary is seeded by Alembic migration 0007, not here.
--
-- Demo data (sellers / receipts / payouts / promotions / notifications) lives
-- in seed_demo.sql and is applied by src/scripts/seed_dev.py ONLY when the
-- SEED_DEMO env flag is truthy — so a production restart never re-creates
-- demo sellers or unverifiable seed:// receipts in the admin review queue.
--
-- Manual usage:
--   docker compose exec -T postgres psql -U vliq -d vliq < backend/seed_dev.sql

-- ---------------------------------------------------------------------------
-- Brand — the default brand every seller / promotion references (FK target).
-- ---------------------------------------------------------------------------

INSERT INTO vliq.brand (id, name, slug, settings, is_active, created_at, updated_at)
VALUES (1, 'VLIQ', 'vliq', '{}'::jsonb, true, now(), now())
ON CONFLICT (slug) DO NOTHING;

SELECT setval(pg_get_serial_sequence('vliq.brand', 'id'),
              GREATEST((SELECT MAX(id) FROM vliq.brand), 1));

-- ---------------------------------------------------------------------------
-- Admins — real Telegram logins for the admin panel. seed_dev.sql runs on every
-- backend start, so this keeps these accounts admins across rebuilds / DB resets.
-- Without them, opening the Mini App with these accounts falls through to the
-- seller auto-create flow (role=seller) and gets stuck on registration.
-- ---------------------------------------------------------------------------

INSERT INTO vliq.admin (
    telegram_id, phone_e164, first_name, last_name, role, brand_ids,
    is_active, created_at, updated_at
) VALUES (
    809296638, '+79990000001', 'Admin', 'VLIQ', 'super_admin', '[]'::jsonb,
    true, now(), now()
)
ON CONFLICT (telegram_id) DO NOTHING;

-- Dev / smoke-test admins (T1)
INSERT INTO vliq.admin (
    telegram_id, phone_e164, first_name, last_name, role, brand_ids,
    is_active, created_at, updated_at
) VALUES
    (99999, '+79990099999', 'Super', 'Admin', 'super_admin', '[]'::jsonb, true, now(), now()),
    (99998, '+79990099998', 'Regular', 'Admin', 'admin', '[]'::jsonb, true, now(), now())
ON CONFLICT (telegram_id) DO NOTHING;

-- Real owner/tester admin (Telegram id 997459169).
INSERT INTO vliq.admin (
    telegram_id, phone_e164, first_name, last_name, role, brand_ids,
    is_active, created_at, updated_at
) VALUES
    (997459169, '+79990000002', 'Owner', 'VLIQ', 'super_admin', '[]'::jsonb, true, now(), now())
ON CONFLICT (telegram_id) DO UPDATE SET is_active = true, role = 'super_admin';
