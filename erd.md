erDiagram
    BRANDS ||--o{ SELLERS : ""
    BRANDS ||--o{ ADMINS : ""
    BRANDS ||--o{ SKUS : ""
    BRANDS ||--o{ PROMOTIONS : ""
    BRANDS ||--o{ RECEIPTS : ""
    BRANDS ||--o{ PAYOUT_REQUESTS : ""
    BRANDS ||--o{ BONUS_TRANSACTIONS : ""

    SELLERS ||--o{ RECEIPTS : ""
    SELLERS ||--o{ BONUS_TRANSACTIONS : ""
    SELLERS ||--o{ PAYOUT_REQUESTS : ""
    SELLERS ||--o{ NOTIFICATIONS : ""

    ADMINS ||--o{ AUDIT_LOG : ""
    SELLERS ||--o{ AUDIT_LOG : ""

    RECEIPTS ||--o{ BONUS_TRANSACTIONS : "source"
    PROMOTIONS ||--o{ BONUS_TRANSACTIONS : ""

    BRANDS {
        bigint id PK
        string name
        string slug UK
        jsonb settings
        bool is_active
        timestamp created_at
        uint64 created_by
        timestamp updated_at
        uint64 updated_by
    }
    SELLERS {
        uint64 telegram_id PK
        bigint brand_id FK
        string phone_e164 UK
        string first_name
        string last_name
        string city
        string region
        string outlet_name
        string outlet_address
        string outlet_chain
        string outlet_inn
        string position
        enum status "active|pending|blocked"
        string block_reason
        enum payout_kind "card|sbp_phone|sbp_bank"
        string payout_masked
        string payout_encrypted
        timestamp consent_pdn_at
        timestamp created_at
        uint64 created_by
        timestamp updated_at
        uint64 updated_by
    }
    ADMINS {
        uint64 telegram_id PK
        string phone_e164 UK
        string first_name
        string last_name
        enum role "admin|super_admin"
        jsonb brand_ids "массив id брендов; пусто = все"
        bool is_active
        timestamp created_at
        uint64 created_by
        timestamp updated_at
        uint64 updated_by
    }
    SKUS {
        bigint id PK
        bigint brand_id FK
        string code UK
        string name
        string category
        int default_bonus
        jsonb aliases "массив строк для OCR-матчинга"
        bool is_active
        timestamp created_at
        uint64 created_by
        timestamp updated_at
        uint64 updated_by
    }
    PROMOTIONS {
        bigint id PK
        bigint brand_id FK
        string name
        string tag
        text description
        timestamp starts_at
        timestamp ends_at
        enum status "draft|active|paused|finished"
        int priority
        jsonb rules "массив правил начисления"
        jsonb scope_cities "массив городов; пусто = все"
        jsonb scope_outlets "массив сетей/ИНН; пусто = все"
        jsonb scope_skus "массив sku_id; пусто = все"
        int per_user_per_day
        int per_user_total
        int total_budget
        timestamp created_at
        uint64 created_by
        timestamp updated_at
        uint64 updated_by
    }
    RECEIPTS {
        bigint id PK
        uint64 seller_id FK
        bigint brand_id FK
        enum status "pending|on_review|approved|rejected|needs_revision|paid_out"
        int bonus_amount
        string rejection_reason
        enum file_kind "photo|pdf|qr|screenshot"
        string file_url
        string file_hash UK
        date purchase_date
        int total_sum
        string shop_name
        string shop_inn
        string qr_raw UK
        string fn
        string fd
        string fp
        float ocr_confidence
        jsonb ocr_raw
        jsonb items "позиции: raw_name, qty, price, matched_sku_id, confidence"
        jsonb fraud_signals "сигналы: signal, severity, duplicate_of_id, details"
        bool is_deleted
        timestamp created_at
        uint64 created_by
        timestamp updated_at
        uint64 updated_by
    }
    BONUS_TRANSACTIONS {
        bigint id PK
        uint64 seller_id FK
        bigint brand_id FK
        int amount "знаковое"
        enum kind "accrual_receipt|accrual_promo|accrual_manual|payout_hold|payout_completed|payout_reverted|correction"
        string source_type "receipt|payout|admin"
        bigint source_id
        bigint promotion_id FK
        text reason
        timestamp created_at
        uint64 created_by
    }
    PAYOUT_REQUESTS {
        bigint id PK
        uint64 seller_id FK
        bigint brand_id FK
        int amount
        enum payout_kind "card|sbp_phone|sbp_bank"
        string payout_masked "снапшот на момент заявки"
        enum status "new|in_progress|paid|rejected"
        text admin_comment
        string external_txn_id
        timestamp created_at
        uint64 created_by
        timestamp updated_at
        uint64 updated_by
    }
    NOTIFICATIONS {
        bigint id PK
        uint64 seller_id FK
        enum type "receipt_approved|receipt_rejected|bonus_accrued|payout_sent|promo_started|promo_ending"
        jsonb payload
        bigint telegram_message_id
        timestamp sent_at
        timestamp read_at
        enum delivery_status
        timestamp created_at
    }
    AUDIT_LOG {
        bigint id PK
        uint64 actor_id
        enum actor_type "seller|admin|system"
        string action "approve_receipt|reject_receipt|edit_bonus|comment|block_seller|approve_payout|..."
        string entity_type "receipt|payout|seller|promotion"
        bigint entity_id
        text comment
        jsonb payload
        timestamp created_at
    }

