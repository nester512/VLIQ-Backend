-- Synthetic LOAD data for the STAGE stand only (never production).
--
-- Bloats the database so admin lists, filters, infinite scroll and dashboard
-- metrics can be tested on realistic volumes. Idempotent: every run first removes
-- the previous load batch (telegram_id >= 9000000000000) and regenerates it.
--
-- Telegram ids start at 9e12 — far above any allocated Telegram user id — so bot
-- notifications for these sellers can never reach a real person.
--
-- Run on the stage server (refuses to run without -v confirm=stage):
--   COMPOSE_PROJECT_NAME=vliq-stage IMAGE_TAG=$(cat .deploy/current-image-tag) \
--   docker compose -f docker-compose.yml -f docker-compose.stage.yml exec -T postgres \
--     psql -U vliq -d vliq -v ON_ERROR_STOP=1 -v confirm=stage -v sellers=2000 < ops/seed_load_stage.sql
--
-- Shape: popularity is heavy-tailed (most sellers upload a few receipts, a few
-- upload hundreds); ~6% of sellers are "risky" (many duplicates / rejections);
-- recent receipts stay on_review; the ledger mirrors what the API writes
-- (accrual_receipt per approval; payout_hold per request; payout_completed /
-- payout_reverted when it is paid / rejected).

\if :{?confirm}
\else
  \echo 'Refusing to run: pass -v confirm=stage (this script is for the stage stand only).'
  \quit
\endif
\if :{?sellers}
\else
  \set sellers 2000
\endif

BEGIN;

SELECT setseed(0.42);

-- 1. Remove the previous load batch.
DELETE FROM vliq.bonus_transaction WHERE seller_id >= 9000000000000;
DELETE FROM vliq.payout_request   WHERE seller_id >= 9000000000000;
DELETE FROM vliq.receipt          WHERE seller_id >= 9000000000000;
DELETE FROM vliq.notification_outbox WHERE recipient_id >= 9000000000000;
DELETE FROM vliq.seller           WHERE telegram_id >= 9000000000000;

-- 2. Sellers.
CREATE TEMP TABLE load_seller ON COMMIT DROP AS
SELECT
    9000000000000 + g                                   AS telegram_id,
    g,
    now() - (random() * interval '180 days')            AS created_at,
    -- heavy tail: E[u^3] = 1/4 -> ~30 receipts on average, up to ~160
    floor(power(random(), 3) * 160)::int                AS n_receipts,
    random() < 0.06                                     AS risky,
    CASE WHEN random() < 0.03 THEN 'blocked'
         WHEN random() < 0.05 THEN 'pending'
         ELSE 'active' END                              AS status
FROM generate_series(1, :sellers) AS g;

INSERT INTO vliq.seller (
    telegram_id, brand_id, phone_e164, first_name, last_name, city, region,
    outlet_name, outlet_address, position, outlet_count, status, block_reason,
    consent_pdn_at, created_at, updated_at
)
SELECT
    s.telegram_id, 1,
    '+7990' || lpad(s.g::text, 7, '0'),
    (ARRAY['Алексей','Ирина','Дмитрий','Марина','Сергей','Анна','Павел','Ольга','Никита','Елена','Артём','Дарья'])[1 + s.g % 12],
    (ARRAY['Морозов','Соколова','Кравцов','Лебедева','Иванов','Кузнецова','Орлов','Белова','Волков','Зайцева'])[1 + (s.g / 12) % 10],
    c.name, c.region,
    (ARRAY['Дымов','VapeShop','Cloud 9','СибВейп','Пар','Облако'])[1 + s.g % 6] || ' #' || (s.g % 97),
    'ул. Тестовая, ' || (s.g % 150),
    (ARRAY['Продавец','Старший продавец','Управляющий'])[1 + s.g % 3],
    1 + s.g % 4,
    s.status::vliq.seller_status_enum,
    CASE WHEN s.status = 'blocked' THEN 'Load test: подозрение на фрод' END,
    s.created_at, s.created_at, s.created_at
FROM load_seller s
CROSS JOIN LATERAL (
    SELECT name, region FROM vliq.city WHERE is_active ORDER BY id OFFSET (s.g % GREATEST(1, (SELECT count(*) FROM vliq.city WHERE is_active))) LIMIT 1
) c;

-- 3. Receipts (seed:// files: no real objects in MinIO).
CREATE TEMP TABLE load_receipt ON COMMIT DROP AS
SELECT
    s.telegram_id AS seller_id,
    s.risky,
    ts,
    CASE
        WHEN ts > now() - interval '3 days' AND random() < 0.85 THEN 'on_review'
        WHEN ts > now() - interval '1 hour' THEN 'pending'
        WHEN random() < CASE WHEN s.risky THEN 0.45 ELSE 0.12 END THEN 'rejected'
        WHEN random() < 0.04 THEN 'on_review'
        ELSE 'approved'
    END AS status,
    (random() < CASE WHEN s.risky THEN 0.35 ELSE 0.03 END) AS dup
FROM load_seller s
CROSS JOIN LATERAL (
    SELECT s.created_at + random() * (now() - s.created_at) AS ts
    FROM generate_series(1, s.n_receipts)
) r;

INSERT INTO vliq.receipt (
    seller_id, brand_id, status, bonus_amount, rejection_reason, rejection_code,
    file_kind, file_url, file_hash, purchase_date, total_sum, shop_name,
    items, fraud_signals, created_at, updated_at
)
SELECT
    r.seller_id, 1, r.status::vliq.receipt_status_enum,
    CASE WHEN r.status = 'approved' THEN (50 + floor(random() * 450))::int * 100 ELSE 0 END,
    CASE WHEN r.status = 'rejected' THEN (ARRAY['Нечитаемое фото','Повторный чек','Не та продукция'])[1 + floor(random() * 3)::int] END,
    NULL,
    'photo', 'seed://load.jpg', md5(r.seller_id::text || r.ts::text),
    r.ts::date, (300 + floor(random() * 4700))::int * 100,
    (ARRAY['Дымов','VapeShop','Cloud 9','СибВейп'])[1 + floor(random() * 4)::int],
    '[]'::jsonb,
    CASE WHEN r.dup THEN jsonb_build_array(jsonb_build_object(
        'signal', 'historical_duplicate_file_hash', 'severity', 'high', 'details', NULL, 'duplicate_of_id', NULL))
         ELSE '[]'::jsonb END,
    r.ts,
    CASE WHEN r.status IN ('approved','rejected') THEN r.ts + random() * interval '2 days' ELSE r.ts END
FROM load_receipt r;

-- 4. Ledger: one accrual per approved receipt.
INSERT INTO vliq.bonus_transaction (seller_id, brand_id, amount, kind, source_type, source_id, reason, created_at)
SELECT seller_id, 1, bonus_amount, 'accrual_receipt', 'receipt', id, 'load test', updated_at
FROM vliq.receipt
WHERE seller_id >= 9000000000000 AND status = 'approved';

-- 5. Payouts: up to 3 per seller, each a share of what that seller earned.
CREATE TEMP TABLE load_payout ON COMMIT DROP AS
SELECT
    e.seller_id,
    GREATEST(100, floor(e.earned * 0.25 * random())::int) AS amount,
    e.first_at + random() * (now() - e.first_at) AS ts,
    CASE WHEN random() < 0.7 THEN 'paid' WHEN random() < 0.33 THEN 'rejected' ELSE 'new' END AS status
FROM (
    SELECT seller_id, sum(amount) AS earned, min(created_at) AS first_at
    FROM vliq.bonus_transaction
    WHERE seller_id >= 9000000000000
    GROUP BY seller_id
) e
CROSS JOIN LATERAL generate_series(1, floor(random() * 4)::int);

CREATE TEMP TABLE load_payout_ids ON COMMIT DROP AS
WITH ins AS (
    INSERT INTO vliq.payout_request (seller_id, brand_id, amount, payout_kind, payout_masked, status, created_at, updated_at)
    SELECT seller_id, 1, amount, 'sbp_phone', '+7990*******', status::vliq.payout_request_status_enum, ts, ts
    FROM load_payout
    RETURNING id, seller_id, amount, status, created_at
)
SELECT * FROM ins;

INSERT INTO vliq.bonus_transaction (seller_id, brand_id, amount, kind, source_type, source_id, reason, created_at)
SELECT seller_id, 1, -amount, 'payout_hold'::vliq.bonus_transaction_kind_enum, 'payout', id, 'load test', created_at FROM load_payout_ids
UNION ALL
SELECT seller_id, 1, -amount, 'payout_completed', 'payout', id, 'load test', created_at + interval '1 day' FROM load_payout_ids WHERE status = 'paid'
UNION ALL
SELECT seller_id, 1, amount, 'payout_reverted', 'payout', id, 'load test', created_at + interval '1 day' FROM load_payout_ids WHERE status = 'rejected';

COMMIT;

-- Summary.
SELECT 'sellers' AS what, count(*)::text AS n FROM vliq.seller WHERE telegram_id >= 9000000000000
UNION ALL SELECT 'receipts', count(*)::text FROM vliq.receipt WHERE seller_id >= 9000000000000
UNION ALL SELECT 'receipts on_review', count(*)::text FROM vliq.receipt WHERE seller_id >= 9000000000000 AND status = 'on_review'
UNION ALL SELECT 'payout requests', count(*)::text FROM vliq.payout_request WHERE seller_id >= 9000000000000
UNION ALL SELECT 'max receipts / seller', max(c)::text FROM (SELECT count(*) c FROM vliq.receipt WHERE seller_id >= 9000000000000 GROUP BY seller_id) x;
