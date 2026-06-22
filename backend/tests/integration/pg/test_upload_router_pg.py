"""Real-PostgreSQL tests for the router's duplicate-warning + enqueue-fallback helpers."""

from __future__ import annotations

import pytest
import src.receipt.handlers.api.v1.router as router_mod
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker
from src.receipt.service import PreparedAttachment, create_receipt_package

from tests.integration.pg._ids import SEED_BRAND_ID, SEED_SELLER_ID

pytestmark = pytest.mark.asyncio


def _att(position: int, file_hash: str) -> PreparedAttachment:
    return PreparedAttachment(position, f"s3://b/{position}.bin", "image/jpeg", file_hash, 100)


async def test_warnings__historical_file_hash_real_db(session_factory: async_sessionmaker) -> None:
    # Prior receipt with a known attachment hash.
    async with session_factory() as s:
        await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID,
            attachments=[_att(0, "shared-hash")], idempotency_key="prior-1234",
        )
    # New receipt reusing the same hash.
    async with session_factory() as s:
        new, _ = await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID,
            attachments=[_att(0, "shared-hash")], idempotency_key="new-1234",
        )
        new_id = new.id
    # The warning query must flag the prior receipt (excluding the new one).
    async with session_factory() as s:
        warnings = await router_mod._build_upload_warnings(
            s, receipt_id=new_id, file_hashes=["shared-hash"], scanned_qr=None
        )
    assert [w.code for w in warnings] == ["POSSIBLE_DUPLICATE"]


async def test_warnings__unique_hash__no_warning(session_factory: async_sessionmaker) -> None:
    async with session_factory() as s:
        new, _ = await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID,
            attachments=[_att(0, "unique-hash")], idempotency_key="uniq-1234",
        )
        new_id = new.id
    async with session_factory() as s:
        warnings = await router_mod._build_upload_warnings(
            s, receipt_id=new_id, file_hashes=["unique-hash"], scanned_qr=None
        )
    assert warnings == []


async def test_enqueue_fallback__pending_becomes_on_review_with_signal(session_factory: async_sessionmaker) -> None:
    async with session_factory() as s:
        receipt, _ = await create_receipt_package(
            s, seller_id=SEED_SELLER_ID, brand_id=SEED_BRAND_ID,
            attachments=[_att(0, "h")], idempotency_key="fallback-123",
        )
        rid = receipt.id
    # Simulate enqueue failure → fallback.
    async with session_factory() as s:
        await router_mod._fallback_to_on_review_no_job(s, rid)
    async with session_factory() as s:
        row = (
            await s.execute(
                text("SELECT status, fraud_signals FROM vliq.receipt WHERE id=:id"), {"id": rid}
            )
        ).one()
    assert row.status == "on_review"
    assert any(sig.get("signal") == "pipeline_enqueue_failed" for sig in row.fraud_signals)
