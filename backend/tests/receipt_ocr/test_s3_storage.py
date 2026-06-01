"""Tests for S3FileStorage and LocalFileStorage.

S3 tests mock the aioboto3 client using unittest.mock so no real network
or MinIO instance is needed.  The mock is injected by replacing
S3FileStorage._make_client with a factory that returns an async context
manager yielding a pre-configured MagicMock.
"""

from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from src.receipt_ocr.storage import LocalFileStorage, S3FileStorage

# ---------------------------------------------------------------------------
# Helpers — in-process fake S3 backed by a dict
# ---------------------------------------------------------------------------

_SAMPLE_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 12  # minimal JPEG-ish header bytes


class _FakeS3Store:
    """Minimal in-memory S3 store used to back the mocked aioboto3 client.

    Tracks multipart upload calls for assertion in tests:
        - ``multipart_uploads``: list of ``(bucket, key, upload_id)`` for
          completed ``create_multipart_upload`` calls.
        - ``multipart_parts``: list of ``(bucket, key, upload_id, part_number, len(body))``
          for each ``upload_part`` call.
        - ``multipart_completions``: list of ``(bucket, key, upload_id)`` for
          completed ``complete_multipart_upload`` calls.
        - ``multipart_aborts``: list of ``(bucket, key, upload_id)`` for
          ``abort_multipart_upload`` calls.
        - ``presigned_get_calls``: list of recorded ``generate_presigned_url`` calls.
        - ``presigned_post_calls``: list of recorded ``generate_presigned_post`` calls.
    """

    def __init__(self) -> None:
        self._objects: dict[tuple[str, str], bytes] = {}  # (bucket, key) → bytes
        self._in_progress_parts: dict[str, dict[int, bytes]] = {}  # upload_id → {part_number: chunk}
        self._in_progress_meta: dict[str, tuple[str, str]] = {}  # upload_id → (bucket, key)

        # Audit trails for test assertions.
        self.multipart_uploads: list[tuple[str, str, str]] = []
        self.multipart_parts: list[tuple[str, str, str, int, int]] = []
        self.multipart_completions: list[tuple[str, str, str]] = []
        self.multipart_aborts: list[tuple[str, str, str]] = []
        self.presigned_get_calls: list[dict] = []
        self.presigned_post_calls: list[dict] = []

    def build_client_mock(self) -> MagicMock:  # noqa: PLR0915
        """Return a mock that mimics the aioboto3 S3 async client interface."""
        store = self._objects
        in_progress_parts = self._in_progress_parts
        in_progress_meta = self._in_progress_meta
        audit = self
        client = MagicMock()

        async def put_object(*, Bucket: str, Key: str, Body: bytes, ContentType: str) -> dict:  # noqa: N803
            store[(Bucket, Key)] = Body
            return {}

        async def get_object(*, Bucket: str, Key: str) -> dict:  # noqa: N803
            if (Bucket, Key) not in store:
                err = MagicMock()
                err.__class__ = client.exceptions.NoSuchKey
                raise client.exceptions.NoSuchKey(
                    {"Error": {"Code": "NoSuchKey", "Message": "Not Found"}},
                    "GetObject",
                )
            body_bytes = store[(Bucket, Key)]
            body_mock = AsyncMock()
            body_mock.read = AsyncMock(return_value=body_bytes)
            return {"Body": body_mock}

        async def head_bucket(*, Bucket: str) -> dict:  # noqa: N803
            if not any(k[0] == Bucket for k in store):
                raise Exception("NoSuchBucket")
            return {}

        async def create_bucket(*, Bucket: str, **_kwargs: object) -> dict:  # noqa: N803
            # Mark bucket as existing by inserting a sentinel key.
            store[(Bucket, "__bucket_created__")] = b""
            return {}

        async def list_buckets() -> dict:
            buckets = list({k[0] for k in store})
            return {"Buckets": [{"Name": b} for b in buckets]}

        # ---- Multipart upload methods ----------------------------------------

        _upload_counter = {"n": 0}

        async def create_multipart_upload(*, Bucket: str, Key: str, ContentType: str) -> dict:  # noqa: N803
            _upload_counter["n"] += 1
            upload_id = f"upload-{_upload_counter['n']}"
            in_progress_parts[upload_id] = {}
            in_progress_meta[upload_id] = (Bucket, Key)
            audit.multipart_uploads.append((Bucket, Key, upload_id))
            return {"UploadId": upload_id}

        async def upload_part(*, Bucket: str, Key: str, UploadId: str, PartNumber: int, Body: bytes) -> dict:  # noqa: N803
            in_progress_parts[UploadId][PartNumber] = Body
            audit.multipart_parts.append((Bucket, Key, UploadId, PartNumber, len(Body)))
            return {"ETag": f'"etag-{PartNumber}"'}

        async def complete_multipart_upload(*, Bucket: str, Key: str, UploadId: str, MultipartUpload: dict) -> dict:  # noqa: N803
            parts = in_progress_parts.pop(UploadId, {})
            in_progress_meta.pop(UploadId, None)
            # Reassemble chunks in part-number order.
            assembled = b"".join(parts[p] for p in sorted(parts))
            store[(Bucket, Key)] = assembled
            audit.multipart_completions.append((Bucket, Key, UploadId))
            return {"Location": f"http://fake/{Bucket}/{Key}", "ETag": '"final-etag"'}

        async def abort_multipart_upload(*, Bucket: str, Key: str, UploadId: str) -> dict:  # noqa: N803
            in_progress_parts.pop(UploadId, None)
            in_progress_meta.pop(UploadId, None)
            audit.multipart_aborts.append((Bucket, Key, UploadId))
            return {}

        # ---- Presigned URL helpers -------------------------------------------

        async def generate_presigned_url(operation: str, Params: dict, ExpiresIn: int) -> str:  # noqa: N803
            audit.presigned_get_calls.append({"operation": operation, "Params": Params, "ExpiresIn": ExpiresIn})
            bucket = Params.get("Bucket", "")
            key = Params.get("Key", "")
            return f"https://fake-s3.example.com/{bucket}/{key}?X-Amz-Expires={ExpiresIn}"

        async def generate_presigned_post(bucket: str, key: str, Fields: dict, Conditions: list, ExpiresIn: int) -> dict:  # noqa: N803
            audit.presigned_post_calls.append(
                {"bucket": bucket, "key": key, "Fields": Fields, "Conditions": Conditions, "ExpiresIn": ExpiresIn}
            )
            return {
                "url": f"https://fake-s3.example.com/{bucket}",
                "fields": {**Fields, "key": key, "X-Amz-Signature": "fakesig"},
            }

        client.put_object = put_object
        client.get_object = get_object
        client.head_bucket = head_bucket
        client.create_bucket = create_bucket
        client.list_buckets = list_buckets
        client.create_multipart_upload = create_multipart_upload
        client.upload_part = upload_part
        client.complete_multipart_upload = complete_multipart_upload
        client.abort_multipart_upload = abort_multipart_upload
        client.generate_presigned_url = generate_presigned_url
        client.generate_presigned_post = generate_presigned_post
        client.exceptions = MagicMock()
        client.exceptions.NoSuchKey = type("NoSuchKey", (Exception,), {})
        return client


def _make_s3_storage_with_fake(
    store: _FakeS3Store,
    bucket: str = "test-bucket",
) -> S3FileStorage:
    """Build S3FileStorage and inject a fake aioboto3 client."""
    storage = S3FileStorage(
        bucket=bucket,
        endpoint_url=None,
        access_key="test",
        secret_key="test",
        region="us-east-1",
        prefix="receipts/",
    )
    client_mock = store.build_client_mock()

    @asynccontextmanager  # type: ignore[arg-type]
    async def _fake_make_client():
        yield client_mock

    storage._make_client = _fake_make_client  # type: ignore[method-assign]
    return storage


# ---------------------------------------------------------------------------
# S3FileStorage tests
# ---------------------------------------------------------------------------


async def test_s3_storage__save_then_read__round_trip():
    """Saved bytes must be retrievable via the returned URI."""
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)

    data = _SAMPLE_JPEG
    uri = await storage.save(data, "image/jpeg", telegram_id=42)

    assert uri.startswith("s3://test-bucket/receipts/")
    assert uri.endswith(".jpg")

    retrieved = await storage.read(uri)
    assert retrieved == data


async def test_s3_storage__save__generates_sha256_key():
    """The key component of the URI must be sha256(data).<ext>."""
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)

    data = b"hello receipt"
    uri = await storage.save(data, "image/png", telegram_id=1)

    # Parse the key from the URI: s3://bucket/prefix/sha256.ext
    without_scheme = uri[len("s3://"):]
    key = without_scheme[without_scheme.index("/") + 1:]  # strip bucket/
    key_filename = key.split("/")[-1]  # strip prefix
    stem, ext = key_filename.rsplit(".", 1)

    expected_digest = hashlib.sha256(data).hexdigest()
    assert stem == expected_digest
    assert ext == "png"


async def test_s3_storage__read_local_uri__falls_through_to_local_storage(tmp_path: Path):
    """local:// URIs must be handled by LocalFileStorage fallback."""
    # Write a file via LocalFileStorage first.
    local = LocalFileStorage(base_dir=tmp_path)
    data = b"some receipt bytes"
    uri = await local.save(data, "image/jpeg", telegram_id=0)
    assert uri.startswith("local://")

    # Build S3FileStorage and inject the local fallback pointing at tmp_path.
    storage = S3FileStorage(
        bucket="irrelevant",
        endpoint_url="http://localhost:9999",
        access_key="x",
        secret_key="x",
    )
    storage._local = local  # type: ignore[attr-defined]

    result = await storage.read(uri)
    assert result == data


async def test_s3_storage__nonexistent_key__raises_clear_error():
    """Reading a non-existent S3 key must raise FileNotFoundError."""
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)

    with pytest.raises(FileNotFoundError, match="S3 object not found"):
        await storage.read("s3://test-bucket/receipts/doesnotexist.jpg")


async def test_s3_storage__ensure_bucket__creates_missing_bucket():
    """ensure_bucket() must attempt to create the bucket when not found."""
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store, bucket="auto-created-bucket")
    # Initially the fake store is empty — head_bucket will raise, triggering create_bucket.
    await storage.ensure_bucket()
    # Verify create_bucket was called by checking sentinel key.
    assert ("auto-created-bucket", "__bucket_created__") in store._objects


def test_s3_storage__parse_s3_uri__valid():
    """_parse_s3_uri must correctly split bucket and key."""
    bucket, key = S3FileStorage._parse_s3_uri("s3://my-bucket/prefix/sha256.jpg")
    assert bucket == "my-bucket"
    assert key == "prefix/sha256.jpg"


def test_s3_storage__parse_s3_uri__invalid_raises_value_error():
    """_parse_s3_uri must raise ValueError for non-S3 URIs."""
    with pytest.raises(ValueError, match="Not an S3 URI"):
        S3FileStorage._parse_s3_uri("local://something.jpg")

    with pytest.raises(ValueError, match="missing key"):
        S3FileStorage._parse_s3_uri("s3://bucket-only")


# ---------------------------------------------------------------------------
# LocalFileStorage tests
# ---------------------------------------------------------------------------


async def test_local_storage__save_then_read__round_trip(tmp_path: Path):
    """Bytes saved to LocalFileStorage must be retrievable by URI."""
    storage = LocalFileStorage(base_dir=tmp_path)
    data = b"receipt image data"
    uri = await storage.save(data, "image/jpeg", telegram_id=99)

    assert uri.startswith("local://")
    assert uri.endswith(".jpg")

    retrieved = await storage.read(uri)
    assert retrieved == data


async def test_local_storage__save__sha256_filename(tmp_path: Path):
    """Saved file name must be sha256(data).ext."""
    storage = LocalFileStorage(base_dir=tmp_path)
    data = b"deterministic"
    uri = await storage.save(data, "image/png", telegram_id=0)

    filename = uri[len("local://"):]
    stem, ext = filename.rsplit(".", 1)
    assert stem == hashlib.sha256(data).hexdigest()
    assert ext == "png"


async def test_local_storage__read__missing_file_raises(tmp_path: Path):
    """Reading a URI that has no corresponding file must raise FileNotFoundError."""
    storage = LocalFileStorage(base_dir=tmp_path)
    with pytest.raises(FileNotFoundError):
        await storage.read("local://nonexistent.jpg")


# ---------------------------------------------------------------------------
# T3 — Multipart upload tests
# ---------------------------------------------------------------------------


async def test_s3_storage__large_file__uses_multipart():
    """A 10 MiB body must trigger the multipart upload code path.

    Verifies:
    - ``create_multipart_upload`` was called exactly once.
    - ``upload_part`` was called twice (2 × 5 MiB chunks).
    - ``complete_multipart_upload`` was called with both parts.
    - ``abort_multipart_upload`` was NOT called (no failure).
    - The final assembled bytes stored in the fake store equal the original data.
    """
    _10_MIB = 10 * 1024 * 1024
    data = b"X" * _10_MIB

    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)
    uri = await storage.save(data, "application/pdf", telegram_id=7)

    # Should have gone through multipart path.
    assert len(store.multipart_uploads) == 1, "Expected exactly one create_multipart_upload call"
    assert len(store.multipart_parts) == 2, "Expected 2 upload_part calls for 10 MiB file"
    assert len(store.multipart_completions) == 1, "Expected one complete_multipart_upload call"
    assert len(store.multipart_aborts) == 0, "abort should not have been called on success"

    # Parts must be 5 MiB each.
    part_sizes = [p[4] for p in store.multipart_parts]
    assert all(sz == 5 * 1024 * 1024 for sz in part_sizes), f"Unexpected part sizes: {part_sizes}"

    # Reassembled data in the store must equal the original.
    bucket, key = S3FileStorage._parse_s3_uri(uri)
    assert store._objects[(bucket, key)] == data

    # URI must follow s3:// scheme and end with .pdf.
    assert uri.startswith("s3://test-bucket/receipts/")
    assert uri.endswith(".pdf")


async def test_s3_storage__large_file__aborts_on_part_failure():
    """If an upload_part call raises, abort_multipart_upload must be invoked."""
    # Override upload_part on the store mock to fail on part 2.
    original_build = _FakeS3Store.build_client_mock

    def _patched_build(self_inner: _FakeS3Store) -> MagicMock:
        client = original_build(self_inner)
        original_upload_part = client.upload_part
        call_count = {"n": 0}

        async def flaky_upload_part(**kwargs):  # type: ignore[no-untyped-def]
            call_count["n"] += 1
            if call_count["n"] >= 2:
                raise RuntimeError("Simulated S3 part failure")
            return await original_upload_part(**kwargs)

        client.upload_part = flaky_upload_part
        return client

    store2 = _FakeS3Store()
    storage2 = S3FileStorage(
        bucket="test-bucket",
        endpoint_url=None,
        access_key="test",
        secret_key="test",
        region="us-east-1",
        prefix="receipts/",
    )
    client_mock = _patched_build(store2)

    from contextlib import asynccontextmanager  # noqa: PLC0415

    @asynccontextmanager  # type: ignore[arg-type]
    async def _fake_make_client():
        yield client_mock

    storage2._make_client = _fake_make_client  # type: ignore[method-assign]

    _10_MIB = 10 * 1024 * 1024
    data = b"Y" * _10_MIB

    with pytest.raises(RuntimeError, match="Simulated S3 part failure"):
        await storage2.save(data, "application/pdf", telegram_id=9)

    assert len(store2.multipart_aborts) == 1, "abort_multipart_upload must be called on part failure"


async def test_s3_storage__small_file__uses_put_object():
    """A file under 5 MiB must use put_object (not multipart)."""
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)

    data = b"small receipt" * 100  # well under 5 MiB
    await storage.save(data, "image/jpeg", telegram_id=1)

    assert len(store.multipart_uploads) == 0, "put_object path should not create a multipart upload"


# ---------------------------------------------------------------------------
# T4 — Presigned URL helpers tests
# ---------------------------------------------------------------------------


async def test_s3_storage__generate_presigned_get_url__shape():
    """generate_presigned_get_url must call generate_presigned_url and return a URL string.

    In tests the fake mock returns a deterministic URL; in production the real
    aioboto3 presigned URL is returned (requires live credentials / moto).
    """
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)

    uri = "s3://test-bucket/receipts/abc123.jpg"
    url = await storage.generate_presigned_get_url(uri, expires_in=1800)

    assert isinstance(url, str)
    assert "test-bucket" in url
    assert "abc123.jpg" in url
    assert "1800" in url  # ExpiresIn embedded in the fake URL

    assert len(store.presigned_get_calls) == 1
    call = store.presigned_get_calls[0]
    assert call["operation"] == "get_object"
    assert call["Params"]["Bucket"] == "test-bucket"
    assert call["Params"]["Key"] == "receipts/abc123.jpg"
    assert call["ExpiresIn"] == 1800


async def test_s3_storage__generate_presigned_post_url__shape():
    """generate_presigned_post_url must return (url, fields, expected_uri) triple.

    - ``url`` must be a string pointing at the bucket.
    - ``fields`` must include the MIME type.
    - ``expected_uri`` must be an ``s3://`` URI namespaced by telegram_id.

    In tests the fake mock records the call; in production the real aioboto3
    presigned POST is returned (requires live credentials / moto).
    """
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)

    url, fields, expected_uri = await storage.generate_presigned_post_url(
        mime="image/jpeg",
        telegram_id=42,
        expires_in=300,
    )

    assert isinstance(url, str)
    assert "test-bucket" in url

    assert isinstance(fields, dict)
    assert fields.get("Content-Type") == "image/jpeg"

    assert expected_uri.startswith("s3://test-bucket/receipts/42/")
    assert expected_uri.endswith(".jpg")

    assert len(store.presigned_post_calls) == 1
    call = store.presigned_post_calls[0]
    assert call["bucket"] == "test-bucket"
    assert call["key"].startswith("receipts/42/")
    assert call["ExpiresIn"] == 300


async def test_s3_storage__generate_presigned_post_url__pdf_mime():
    """generate_presigned_post_url must handle application/pdf correctly."""
    store = _FakeS3Store()
    storage = _make_s3_storage_with_fake(store)

    _url, fields, expected_uri = await storage.generate_presigned_post_url(
        mime="application/pdf",
        telegram_id=99,
        expires_in=600,
    )

    assert expected_uri.endswith(".pdf")
    assert fields.get("Content-Type") == "application/pdf"
