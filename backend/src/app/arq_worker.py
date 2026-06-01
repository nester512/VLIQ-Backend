"""arq worker entry point.

Launch with:
    arq src.app.arq_worker.WorkerSettings

The worker connects to Redis, picks up ``process_receipt_task`` jobs enqueued
by the upload handler, and runs the ReceiptPipelineOrchestrator.

Context lifecycle (startup/shutdown functions below):
    - ``ctx['sessionmaker']``  — async_sessionmaker tied to the shared engine
    - ``ctx['orchestrator']``  — ReceiptPipelineOrchestrator (singleton per worker)
"""

from __future__ import annotations

import logging

from arq.connections import RedisSettings
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Side-effect imports: register every ORM model so SQLAlchemy can resolve
# cross-table FK relationships (Receipt.seller_id → Seller.telegram_id, etc.)
# before the worker issues its first query. Without this the worker raises
# `Foreign key … could not find table 'vliq.seller'` on the first task.
from src.admin import models as _admin_models  # noqa: F401
from src.app.depends import get_config
from src.audit_log import models as _audit_models  # noqa: F401
from src.bonus_transaction import models as _bonus_models  # noqa: F401
from src.brand import models as _brand_models  # noqa: F401
from src.fraud.checks import FraudChecker
from src.notification import models as _notif_models  # noqa: F401
from src.ofd_client.cache import InMemoryOFDCache, RedisOFDCache
from src.ofd_client.fake import FakeOFDClient
from src.ofd_client.proverkacheka import ProverkachekaClient
from src.payout_request import models as _payout_models  # noqa: F401
from src.promotion import models as _promo_models  # noqa: F401
from src.receipt import models as _receipt_models  # noqa: F401
from src.receipt_ocr.qr_extractor import QRExtractor
from src.receipt_pipeline.orchestrator import ReceiptPipelineOrchestrator
from src.seller import models as _seller_models  # noqa: F401
from src.sku import models as _sku_models  # noqa: F401
from src.sku_matcher.matcher import SkuMatcher

logger = logging.getLogger(__name__)


def _make_redis_settings() -> RedisSettings:
    """Build RedisSettings from application config.

    Falls back to localhost:6379 if settings cannot be loaded at import time
    (e.g., missing env vars in CI that don't run the worker).
    """
    try:
        cfg = get_config()
        return RedisSettings.from_dsn(cfg.REDIS_URL)
    except Exception:
        return RedisSettings(host="localhost", port=6379)


# ---------------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------------


async def process_receipt_task(ctx: dict, receipt_id: int) -> None:
    """arq task: run the full OCR → OFD → bonus pipeline for *receipt_id*.

    Args:
        ctx: arq worker context (populated by ``on_startup``).
        receipt_id: PK of the receipt to process.
    """
    job_id = ctx.get("job_id", "unknown")
    logger.info("arq.task_start, receipt_id=%d, job_id=%s", receipt_id, job_id)
    orchestrator: ReceiptPipelineOrchestrator = ctx["orchestrator"]
    session_factory: async_sessionmaker[AsyncSession] = ctx["sessionmaker"]

    async with session_factory() as session:
        try:
            await orchestrator.process(receipt_id, session)
        except Exception as exc:
            logger.exception("arq.task_error, receipt_id=%d: %s", receipt_id, exc)
            raise  # re-raise so arq marks the job as failed

    logger.info("arq.task_done, receipt_id=%d", receipt_id)


# ---------------------------------------------------------------------------
# Worker lifecycle
# ---------------------------------------------------------------------------


async def on_startup(ctx: dict) -> None:
    """Initialise DB engine, session factory, and orchestrator on worker start."""
    settings = get_config()

    engine = create_async_engine(
        settings.postgres.POSTGRES_URL,
        echo=False,
        pool_size=5,
        pool_pre_ping=True,
        future=True,
    )
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    ctx["engine"] = engine
    ctx["sessionmaker"] = session_factory

    # OFD client selection driven by settings.OFD_PROVIDER.
    provider = settings.OFD_PROVIDER
    if provider == "proverkacheka":
        token = settings.PROVERKACHEKA_TOKEN
        if not token:
            raise RuntimeError("PROVERKACHEKA_TOKEN must be set when OFD_PROVIDER=proverkacheka")
        ofd_client = ProverkachekaClient(token=token)
        ofd_cache: object = RedisOFDCache(settings.REDIS_URL)
    else:
        # Default / test mode: FakeOFDClient + InMemoryOFDCache.
        ofd_client = FakeOFDClient()  # type: ignore[assignment]
        ofd_cache = InMemoryOFDCache()

    ctx["orchestrator"] = ReceiptPipelineOrchestrator(
        ofd_client=ofd_client,  # type: ignore[arg-type]
        ofd_cache=ofd_cache,  # type: ignore[arg-type]
        qr_extractor=QRExtractor(),
        sku_matcher=SkuMatcher(),
        fraud_checker=FraudChecker(),
    )

    logger.info("arq.worker_startup, ofd_provider=%s", provider)


async def on_shutdown(ctx: dict) -> None:
    """Dispose DB engine on worker shutdown."""
    engine = ctx.get("engine")
    if engine is not None:
        await engine.dispose()
    logger.info("arq.worker_shutdown")


# ---------------------------------------------------------------------------
# WorkerSettings
# ---------------------------------------------------------------------------


class WorkerSettings:
    """arq worker configuration.

    Run with:
        arq src.app.arq_worker.WorkerSettings
    """

    functions = [process_receipt_task]
    cron_jobs: list = []  # placeholder for P2 scheduled tasks (OFD retry scheduler)

    on_startup = on_startup
    on_shutdown = on_shutdown

    redis_settings = _make_redis_settings()

    max_jobs = 10
    job_timeout = 120  # seconds per job before arq kills it
    keep_result = 3600  # keep job result in Redis for 1h for debugging
