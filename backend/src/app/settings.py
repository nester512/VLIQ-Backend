from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field
from pydantic_settings import SettingsConfigDict

from src.app.base_settings import BaseSettings, Env, Postgres
from src.app.root import root_dir

env_file = Path(root_dir, ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_nested_delimiter="__",
        extra="ignore",
        env_file=env_file,
    )

    port: int = 8000
    postgres: Postgres
    env: Env = Env.local

    PATH_PREFIX: str = "/api/v1"

    # H2: No default — Pydantic will raise ValidationError if missing from ENV.
    JWT_SECRET_SALT: str

    # H1 (future): Bot token for TMA initData HMAC verification.
    TG_BOT_TOKEN: str = ""

    # H4: Fernet encryption key for payout_encrypted column.
    # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    # No default — startup fails if missing.
    PAYOUT_ENCRYPTION_KEY: str = ""

    # H6 / H13: Redis URL for rate limiting and idempotency key storage.
    # Example: redis://localhost:6379/0
    REDIS_URL: str = "redis://localhost:6379/0"

    # OFD provider selection.
    # "fake"          → FakeOFDClient (fixture-backed; no network calls — default for dev/test).
    # "proverkacheka" → ProverkachekaClient (real API; requires PROVERKACHEKA_TOKEN).
    # "real"          → alias for proverkacheka (convenience).
    # "ofd_ru"        → OfdRuClient stub (raises NotImplementedError until implemented).
    OFD_PROVIDER: Literal["fake", "proverkacheka", "real", "ofd_ru"] = "fake"

    # API token for proverkacheka.com — required when OFD_PROVIDER=proverkacheka.
    # Obtain from https://proverkacheka.com — free tier: ~100 req/month.
    # NEVER log this value.
    PROVERKACHEKA_TOKEN: Annotated[str | None, Field(repr=False)] = None

    # Base URL for proverkacheka.com API (override for proxies / staging mirrors).
    PROVERKACHEKA_BASE_URL: str = "https://proverkacheka.com/api/v1"

    # OCR mode: "full" runs the complete pipeline (QR → OFD → SKU → bonus).
    # "demo" skips QR/OFD and immediately sets status=on_review with a fixed
    # demo bonus of 250 — suitable for E2E demos without a real OFD token.
    OCR_MODE: Literal["full", "demo"] = "demo"

    # OFD retry / timeout configuration.
    # OFD_TIMEOUT_SECONDS   — per-request HTTP timeout in seconds (default 10).
    # OFD_RETRY_MAX_ATTEMPTS — total attempts including the first try (default 3).
    #   Retries apply to: network timeout, HTTP 5xx, HTTP 429.
    #   4xx errors other than 429 fail fast (no retry).
    OFD_TIMEOUT_SECONDS: float = 10.0
    OFD_RETRY_MAX_ATTEMPTS: int = 3

    # B4: CORS — restrict origins via ENV in production.
    # Example: CORS_ORIGINS='["https://app.vliq.ru","https://vliq.ru"]'
    cors_origins: list[str] = []
    cors_methods: list[str] = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    cors_headers: list[str] = ["*"]

    # Receipt file storage backend.
    # "local" writes files to RECEIPT_STORAGE_DIR (default: var/receipts).
    # "s3"    uses S3-compatible object storage (MinIO locally, AWS/Yandex in prod).
    RECEIPT_STORAGE: str = "local"

    # Local storage directory (used when RECEIPT_STORAGE=local).
    RECEIPT_STORAGE_DIR: str = "var/receipts"

    # S3 / MinIO settings (used when RECEIPT_STORAGE=s3).
    S3_BUCKET: str = "vliq-receipts"
    # S3 endpoint — set to MinIO URL for local dev; leave empty for AWS S3.
    S3_ENDPOINT_URL: str = "http://localhost:9000"
    # Dev defaults — replace with real credentials in staging/prod.
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_REGION: str = "us-east-1"
    S3_PREFIX: str = "receipts/"
