-- Seed brand + admin + a handful of sellers/receipts/payouts/notifications
-- for local dev. Safe to run multiple times — sellers are upserted by PK and
-- the receipts/payouts/transactions/notifications tables are cleared for the
-- demo seller IDs before being re-inserted.
--
-- Usage:
--   docker compose exec -T postgres psql -U vliq -d vliq < backend/seed_dev.sql

-- ---------------------------------------------------------------------------
-- Brand + admin
-- ---------------------------------------------------------------------------

INSERT INTO vliq.brand (id, name, slug, settings, is_active, created_at, updated_at)
VALUES (1, 'VLIQ', 'vliq', '{}'::jsonb, true, now(), now())
ON CONFLICT (slug) DO NOTHING;

SELECT setval(pg_get_serial_sequence('vliq.brand', 'id'),
              GREATEST((SELECT MAX(id) FROM vliq.brand), 1));

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

-- Real owner/tester admin (Telegram id 997459169). seed_dev.sql runs on every
-- backend start, so this keeps the owner an admin across rebuilds / DB resets.
-- Without it, opening the Mini App with this account falls through to the
-- seller auto-create flow (role=seller) and gets stuck on registration.
INSERT INTO vliq.admin (
    telegram_id, phone_e164, first_name, last_name, role, brand_ids,
    is_active, created_at, updated_at
) VALUES
    (997459169, '+79990000002', 'Owner', 'VLIQ', 'super_admin', '[]'::jsonb, true, now(), now())
ON CONFLICT (telegram_id) DO UPDATE SET is_active = true, role = 'super_admin';

-- ---------------------------------------------------------------------------
-- Sellers — mix of pending / active / blocked across cities.
--   12345 is the local dev mock identity (matches AuthGate's MOCK_TELEGRAM_ID)
-- ---------------------------------------------------------------------------

INSERT INTO vliq.seller (
    telegram_id, brand_id, phone_e164, first_name, last_name,
    city, region, outlet_name, outlet_address, position,
    status, payout_kind, payout_masked, consent_pdn_at,
    created_at, updated_at
) VALUES
    (12345,    1, '+79991234567', 'Алексей',  'Морозов',   'Москва',           'Москва',          'Дымов · ТЦ Авиапарк',     'Ходынский б-р 4',   'Продавец-консультант', 'active',  'sbp_phone', '•••• 4117', now() - interval '40 days', now() - interval '40 days', now()),
    (10000001, 1, '+79991110002', 'Ирина',    'Соколова',  'Санкт-Петербург',  'Ленинградская',   'VapeShop · Лиговский 50','Лиговский пр. 50',  'Старший продавец',     'active',  'card',      '•••• 8842', now() - interval '30 days', now() - interval '30 days', now()),
    (10000002, 1, '+79991110003', 'Дмитрий',  'Кравцов',   'Казань',           'Татарстан',       'CloudStore · Кольцо',     'ТРК Кольцо',         'Продавец',             'active',  'sbp_phone', '•••• 2093', now() - interval '25 days', now() - interval '25 days', now()),
    (10000003, 1, '+79991110004', 'Марина',   'Лебедева',  'Москва',           'Москва',          'Дымов · Европейский',    'ТЦ Европейский',     'Продавец',             'active',  'card',      '•••• 4417', now() - interval '20 days', now() - interval '20 days', now()),
    (10000004, 1, '+79991110005', 'Сергей',   'Иванов',    'Екатеринбург',     'Свердловская',    'Гринвич · точка 12',     'ТЦ Гринвич',         'Продавец',             'pending', NULL,        NULL,         NULL,                       now() - interval '3 days',  now()),
    (10000005, 1, '+79991110006', 'Анна',     'Кузнецова', 'Новосибирск',      'Новосибирская',   'СибВейп',                 'Красный пр. 17',     'Продавец',             'blocked', NULL,        NULL,         now() - interval '60 days', now() - interval '60 days', now())
ON CONFLICT (telegram_id) DO UPDATE SET
    -- Idempotent re-seed: ensure the mock identity stays demo-ready even if
    -- the auth handler created a pending row first.
    status        = EXCLUDED.status,
    first_name    = EXCLUDED.first_name,
    last_name     = EXCLUDED.last_name,
    phone_e164    = EXCLUDED.phone_e164,
    city          = EXCLUDED.city,
    outlet_name   = EXCLUDED.outlet_name,
    outlet_address= EXCLUDED.outlet_address,
    position      = EXCLUDED.position,
    payout_kind   = EXCLUDED.payout_kind,
    payout_masked = EXCLUDED.payout_masked,
    consent_pdn_at= EXCLUDED.consent_pdn_at,
    updated_at    = now();

-- ---------------------------------------------------------------------------
-- Receipts — purged + reseeded for the demo sellers only.
--   file_url / file_hash are NOT NULL — we mint synthetic values.
-- ---------------------------------------------------------------------------

DELETE FROM vliq.receipt WHERE seller_id IN (12345, 10000001, 10000002, 10000003);

INSERT INTO vliq.receipt (
    seller_id, brand_id, status, bonus_amount, file_kind, file_url, file_hash,
    purchase_date, total_sum, shop_name, items, fraud_signals,
    is_deleted, created_at, updated_at
) VALUES
    (12345,    1, 'approved',  250, 'photo', 'seed://r1.jpg',  encode(sha256('seed-12345-r1'::bytea),  'hex'), current_date - 4,  3100, 'ИП Дымов А.В.',     '[{"raw_name":"SWONQ L18000","price":1450,"qty":1},{"raw_name":"Жидкость 30мл","price":450,"qty":1}]'::jsonb, '[]'::jsonb, false, now() - interval '4 days', now()),
    (12345,    1, 'approved',  300, 'photo', 'seed://r2.jpg',  encode(sha256('seed-12345-r2'::bytea),  'hex'), current_date - 3,  4200, 'ИП Дымов А.В.',     '[{"raw_name":"SWONQ L18000","price":1450,"qty":2}]'::jsonb, '[]'::jsonb, false, now() - interval '3 days', now()),
    (12345,    1, 'on_review', 150, 'photo', 'seed://r3.jpg',  encode(sha256('seed-12345-r3'::bytea),  'hex'), current_date - 1,  1500, 'ООО ВейпРитейл',    '[{"raw_name":"SWONQ M15000","price":1200,"qty":1}]'::jsonb, '[]'::jsonb, false, now() - interval '1 days', now()),

    (10000001, 1, 'approved',  400, 'photo', 'seed://r4.jpg',  encode(sha256('seed-10000001-r4'::bytea),  'hex'), current_date - 6,  5800, 'ИП Соколова',  '[{"raw_name":"SWONQ L18000","price":1450,"qty":4}]'::jsonb, '[]'::jsonb, false, now() - interval '6 days', now()),
    (10000001, 1, 'approved',  250, 'photo', 'seed://r5.jpg',  encode(sha256('seed-10000001-r5'::bytea),  'hex'), current_date - 5,  3100, 'ИП Соколова',  '[{"raw_name":"SWONQ M15000","price":1200,"qty":2}]'::jsonb, '[]'::jsonb, false, now() - interval '5 days', now()),
    (10000001, 1, 'paid_out',  200, 'photo', 'seed://r6.jpg',  encode(sha256('seed-10000001-r6'::bytea),  'hex'), current_date - 14, 2500, 'ИП Соколова',  '[{"raw_name":"Жидкость 30мл","price":450,"qty":3}]'::jsonb, '[]'::jsonb, false, now() - interval '14 days', now()),

    (10000002, 1, 'approved',  400, 'photo', 'seed://r7.jpg',  encode(sha256('seed-10000002-r7'::bytea),  'hex'), current_date - 7,  5800, 'ИП Кравцов Д.С.', '[{"raw_name":"SWONQ L18000","price":1450,"qty":4}]'::jsonb, '[]'::jsonb, false, now() - interval '7 days', now()),
    (10000002, 1, 'approved',  350, 'photo', 'seed://r8.jpg',  encode(sha256('seed-10000002-r8'::bytea),  'hex'), current_date - 5,  4500, 'ИП Кравцов Д.С.', '[{"raw_name":"Картридж","price":350,"qty":2}]'::jsonb, '[]'::jsonb, false, now() - interval '5 days', now()),
    (10000002, 1, 'on_review', 450, 'photo', 'seed://r9.jpg',  encode(sha256('seed-10000002-r9'::bytea),  'hex'), current_date - 2,  5200, 'ИП Кравцов Д.С.', '[{"raw_name":"SWONQ L18000","price":1450,"qty":3}]'::jsonb, '[]'::jsonb, false, now() - interval '2 days', now()),

    (10000003, 1, 'rejected',       0, 'photo', 'seed://r10.jpg', encode(sha256('seed-10000003-r10'::bytea), 'hex'), current_date - 9,   450, 'ИП Дымов А.В.', '[{"raw_name":"Жидкость 30мл","price":450,"qty":1}]'::jsonb, '[]'::jsonb, false, now() - interval '9 days', now()),
    (10000003, 1, 'pending',        0, 'photo', 'seed://r11.jpg', encode(sha256('seed-10000003-r11'::bytea), 'hex'), NULL,             NULL, NULL,             '[]'::jsonb, '[]'::jsonb, false, now(), now()),
    (10000003, 1, 'needs_revision', 0, 'photo', 'seed://r12.jpg', encode(sha256('seed-10000003-r12'::bytea), 'hex'), current_date - 3, 1200, 'ИП Лебедева',   '[{"raw_name":"Картридж 2мл","price":300,"qty":4}]'::jsonb, '[]'::jsonb, false, now() - interval '3 days', now());

-- ---------------------------------------------------------------------------
-- Bonus transactions — accruals + one historical payout.
-- ---------------------------------------------------------------------------

DELETE FROM vliq.bonus_transaction WHERE seller_id IN (12345, 10000001, 10000002);

-- payout_hold rows hold negative amounts that match the pending payout
-- requests below — so `get_seller_balance` reports a non-zero `on_hold`
-- without going negative.
--
-- Note: Morozov's balance after holds = 550 (accruals) − 100 (hold) = 450
-- available with 100 on hold. We don't hold the full 2 350 because available
-- would otherwise go negative and the service caps it at 0 / refuses payout.
INSERT INTO vliq.bonus_transaction (
    seller_id, brand_id, amount, kind, source_type, source_id, created_at
) VALUES
    (12345,    1,  250, 'accrual_receipt',  'receipt', NULL, now() - interval '4 days'),
    (12345,    1,  300, 'accrual_receipt',  'receipt', NULL, now() - interval '3 days'),
    (12345,    1, -100, 'payout_hold',      'payout',  NULL, now() - interval '1 days'),
    (10000001, 1,  400, 'accrual_receipt',  'receipt', NULL, now() - interval '6 days'),
    (10000001, 1,  250, 'accrual_receipt',  'receipt', NULL, now() - interval '5 days'),
    (10000001, 1,  200, 'accrual_receipt',  'receipt', NULL, now() - interval '14 days'),
    (10000001, 1, -200, 'payout_completed', 'payout',  NULL, now() - interval '12 days'),
    (10000001, 1, -300, 'payout_hold',      'payout',  NULL, now() - interval '2 days'),
    (10000002, 1,  400, 'accrual_receipt',  'receipt', NULL, now() - interval '7 days'),
    (10000002, 1,  350, 'accrual_receipt',  'receipt', NULL, now() - interval '5 days'),
    (10000002, 1, -200, 'payout_hold',      'payout',  NULL, now() - interval '6 hours')
;

-- ---------------------------------------------------------------------------
-- Payout requests — across all statuses for admin demo.
-- ---------------------------------------------------------------------------

DELETE FROM vliq.payout_request WHERE seller_id IN (12345, 10000001, 10000002);

INSERT INTO vliq.payout_request (
    seller_id, brand_id, amount, payout_kind, payout_masked, status,
    created_at, updated_at
) VALUES
    (12345,    1, 2350, 'sbp_phone', '•••• 4117', 'new',         now() - interval '1 days',  now()),
    (10000001, 1, 3100, 'card',      '•••• 8842', 'in_progress', now() - interval '2 days',  now()),
    (10000002, 1, 5800, 'sbp_phone', '•••• 2093', 'new',         now() - interval '6 hours', now()),
    (10000001, 1,  200, 'card',      '•••• 8842', 'paid',        now() - interval '13 days', now() - interval '12 days');

-- ---------------------------------------------------------------------------
-- Promotions — three active for the brand. Frontend reads via GET /promotions.
-- ---------------------------------------------------------------------------

DELETE FROM vliq.promotion WHERE brand_id = 1;

INSERT INTO vliq.promotion (
    brand_id, name, tag, description,
    starts_at, ends_at, status, priority,
    rules, scope_cities, scope_outlets, scope_skus,
    per_user_per_day, per_user_total, total_budget,
    created_at, updated_at
) VALUES
    (1, 'SWONQ — двойной бонус', 'МАЙ 2026',
     'Повышенный бонус на линейку SWONQ во всех городах. До 31 мая.',
     now() - interval '10 days', now() + interval '30 days',
     'active', 30,
     '[{"sku_code":"SWONQ","multiplier":2}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
     NULL, NULL, NULL,
     now() - interval '10 days', now()),

    (1, 'Новая линейка +400 ₽', 'КАЗАНЬ',
     'Бонус 400 ₽ за чек с новинками в точках Казани.',
     now() - interval '5 days', now() + interval '20 days',
     'active', 20,
     '[{"flat_bonus":400}]'::jsonb, '["Казань"]'::jsonb, '[]'::jsonb, '[]'::jsonb,
     NULL, NULL, NULL,
     now() - interval '5 days', now()),

    (1, 'Первые 10 чеков', 'СТАРТ',
     'Удвоенный бонус за первые 10 загруженных чеков.',
     now() - interval '30 days', now() + interval '60 days',
     'active', 10,
     '[{"first_n_receipts":10,"multiplier":2}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
     NULL, 10, NULL,
     now() - interval '30 days', now());

-- ---------------------------------------------------------------------------
-- Notifications for Morozov (12345) — one unread, two read.
-- ---------------------------------------------------------------------------

DELETE FROM vliq.notification WHERE seller_id IN (12345, 10000001, 10000002, 10000003, 10000004, 10000005);

INSERT INTO vliq.notification (
    seller_id, type, payload, delivery_status, sent_at, read_at, created_at
) VALUES
    -- Morozov (12345): one unread (receipt_approved), two read
    (12345, 'receipt_approved',
       '{"title":"Чек одобрен","body":"+300 ₽ за чек №2","amount":300}'::jsonb,
       'sent', now() - interval '3 days', NULL,                       now() - interval '3 days'),
    (12345, 'bonus_accrued',
       '{"title":"Бонус начислен","body":"+250 ₽ по акции"}'::jsonb,
       'sent', now() - interval '4 days', now() - interval '2 days',  now() - interval '4 days'),
    (12345, 'promo_started',
       '{"title":"Новая акция","body":"SWONQ — двойной бонус до 31 мая"}'::jsonb,
       'sent', now() - interval '7 days', now() - interval '6 days',  now() - interval '7 days'),

    -- Sokolova (10000001): one unread payout notification
    (10000001, 'payout_sent',
       '{"title":"Выплата отправлена","body":"200 ₽ → •••• 8842","amount":200}'::jsonb,
       'sent', now() - interval '12 days', NULL,                      now() - interval '12 days'),

    -- Kravtsov (10000002): one unread bonus notification
    (10000002, 'receipt_approved',
       '{"title":"Чек одобрен","body":"+400 ₽ за чек","amount":400}'::jsonb,
       'sent', now() - interval '7 days', NULL,                       now() - interval '7 days'),

    -- Lebedeva (10000003): one unread revision request
    (10000003, 'receipt_approved',
       '{"title":"Чек требует уточнения","body":"Уточните данные по чеку"}'::jsonb,
       'sent', now() - interval '3 days', NULL,                       now() - interval '3 days');
