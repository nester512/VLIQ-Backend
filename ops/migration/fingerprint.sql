-- Fingerprint of the data that existed before migrations 0009–0014 (schema 0008).
-- Aggregates only: row counts, sums and order-independent checksums. No personal data leaves
-- the database. Run BEFORE and AFTER the migration and compare (ops/migration/compare.sh):
-- every line must match except the expected change of 0014 (receipt status approved → paid_out).
--
--   psql -U vliq -d vliq -At -F '|' -f ops/migration/fingerprint.sql > before.txt
--
-- Checksum = sum of 64-bit hashes of the 0008 columns of every row — the same rows with the same
-- values give the same number in any order; one changed value changes it.
\set ON_ERROR_STOP on

SELECT 'admin', count(*), coalesce(sum(hashtextextended(concat_ws('|', telegram_id, phone_e164, first_name, last_name, role, brand_ids, is_active, created_at, updated_at, created_by, updated_by), 0)::numeric), 0) FROM vliq.admin;
SELECT 'audit_log', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, actor_id, actor_type, action, entity_type, entity_id, comment, payload, created_at), 0)::numeric), 0) FROM vliq.audit_log;
SELECT 'bonus_transaction', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, seller_id, brand_id, amount, kind, source_type, source_id, promotion_id, reason, created_by, created_at), 0)::numeric), 0) FROM vliq.bonus_transaction;
SELECT 'brand', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, name, slug, settings, is_active, created_at, updated_at, created_by, updated_by), 0)::numeric), 0) FROM vliq.brand;
SELECT 'city', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, name, region, is_active, sort_order, created_at, updated_at, created_by, updated_by), 0)::numeric), 0) FROM vliq.city;
SELECT 'notification', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, seller_id, type, payload, telegram_message_id, sent_at, read_at, delivery_status, created_at), 0)::numeric), 0) FROM vliq.notification;
SELECT 'notification_outbox', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, created_at, scheduled_at, attempts, last_error, status, recipient_id, channel, template, payload, sent_at), 0)::numeric), 0) FROM vliq.notification_outbox;
SELECT 'payout_request', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, seller_id, brand_id, amount, payout_kind, payout_masked, status, admin_comment, external_txn_id, created_at, updated_at, created_by, updated_by), 0)::numeric), 0) FROM vliq.payout_request;
SELECT 'promotion', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, brand_id, name, tag, description, starts_at, ends_at, status, priority, rules, scope_cities, scope_outlets, scope_skus, per_user_per_day, per_user_total, total_budget, created_at, updated_at, created_by, updated_by), 0)::numeric), 0) FROM vliq.promotion;
-- receipt: every 0008 column EXCEPT status (0014 changes it on purpose; checked separately below)
SELECT 'receipt', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, seller_id, brand_id, bonus_amount, rejection_reason, file_kind, file_url, file_hash, purchase_date, total_sum, shop_name, shop_inn, qr_raw, fn, fd, fp, ocr_confidence, ocr_raw, items, fraud_signals, is_deleted, created_at, updated_at, created_by, updated_by, admin_comments, upload_idempotency_key, rejection_code), 0)::numeric), 0) FROM vliq.receipt;
SELECT 'receipt_attachment', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, receipt_id, position, kind, mime_type, storage_uri, file_hash, size_bytes, extraction, created_at), 0)::numeric), 0) FROM vliq.receipt_attachment;
SELECT 'seller', count(*), coalesce(sum(hashtextextended(concat_ws('|', telegram_id, brand_id, phone_e164, first_name, last_name, city, region, outlet_name, outlet_address, outlet_chain, outlet_inn, position, status, block_reason, payout_kind, payout_masked, payout_encrypted, consent_pdn_at, created_at, updated_at, created_by, updated_by, outlet_count), 0)::numeric), 0) FROM vliq.seller;
SELECT 'sku', count(*), coalesce(sum(hashtextextended(concat_ws('|', id, brand_id, code, name, category, default_bonus, aliases, is_active, created_at, updated_at, created_by, updated_by), 0)::numeric), 0) FROM vliq.sku;

-- Money, as numbers a person can read (must be identical before / after)
SELECT 'money.ledger.' || kind, count(*), sum(amount) FROM vliq.bonus_transaction GROUP BY kind ORDER BY kind;
SELECT 'money.payouts.' || status, count(*), sum(amount) FROM vliq.payout_request GROUP BY status ORDER BY status;
SELECT 'money.receipt_bonus_live', count(*), sum(bonus_amount) FROM vliq.receipt WHERE NOT is_deleted;

-- Receipt statuses: the only expected change (0014: approved → paid_out, same total)
SELECT 'receipt.status.' || status, count(*), sum(bonus_amount) FROM vliq.receipt GROUP BY status ORDER BY status;
