"""File storage abstractions for receipt images.

Storage backend selection:
    RECEIPT_STORAGE=local (default) → LocalFileStorage
    RECEIPT_STORAGE=s3              → S3FileStorage (MinIO / AWS S3 / Yandex)

Storage directory for local backend:
    RECEIPT_STORAGE_DIR=<path>  (default: var/receipts relative to project root)

URI schemes produced:
    local://<sha256>.<ext>   — LocalFileStorage
    s3://<bucket>/<key>      — S3FileStorage
"""

from __future__ import annotations

import asyncio
import hashlib
import os
from pathlib import Path
from typing import Protocol, runtime_checkable

import structlog

try:
    import aioboto3  # noqa: F401 — optional dependency; imported lazily in S3FileStorage

    _AIOBOTO3_AVAILABLE = True
except ImportError:
    _AIOBOTO3_AVAILABLE = False

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Project root — two levels up from this file (backend/src/receipt_ocr/ → root)
# ---------------------------------------------------------------------------
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent

# Default local storage directory relative to project root.
_DEFAULT_LOCAL_DIR = _PROJECT_ROOT / "var" / "receipts"

# MIME → file extension map.
_MIME_EXTENSION: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
    "text/plain": "txt",
}


def _ext_for_mime(mime: str) -> str:
    """Return a safe file extension for *mime*, defaulting to 'bin'."""
    return _MIME_EXTENSION.get(mime.split(";")[0].strip().lower(), "bin")


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ReceiptStorage(Protocol):
    """Protocol for receipt file storage backends.

    All implementations must support at least ``save`` and ``read``.
    """

    async def save(self, data: bytes, mime: str, telegram_id: int) -> str:
        """Persist *data* and return a storage URI.

        Args:
            data: Raw file bytes.
            mime: MIME type, e.g. ``image/jpeg``.
            telegram_id: Seller's Telegram user ID (used for namespacing).

        Returns:
            Storage URI (e.g. ``local://<sha256>.jpg``).
        """
        ...

    async def read(self, uri: str) -> bytes:
        """Retrieve raw bytes for the given *uri*.

        Args:
            uri: Storage URI as returned by :meth:`save`.

        Returns:
            Raw file bytes.

        Raises:
            FileNotFoundError: If the URI does not resolve to a readable file.
        """
        ...

    async def delete(self, uri: str) -> None:
        """Best-effort delete of a stored object (used to clean up a half-built
        package). Missing objects are a no-op; failures are logged, not raised."""
        ...


# ---------------------------------------------------------------------------
# Legacy protocol (kept for backward compatibility — old callers use upload())
# ---------------------------------------------------------------------------


@runtime_checkable
class FileStorage(Protocol):
    """Legacy protocol — upload interface only.  Use ReceiptStorage for new code."""

    async def upload(self, file_bytes: bytes, filename: str, mime: str) -> str:
        """Upload *file_bytes* and return a URL or identifier."""
        ...


# ---------------------------------------------------------------------------
# LocalFileStorage
# ---------------------------------------------------------------------------


class LocalFileStorage:
    """Write files under ``${RECEIPT_STORAGE_DIR}/<sha256>.<ext>``.

    URI format: ``local://<sha256>.<ext>``

    Also accepts legacy ``file://`` URIs in :meth:`read` for backward compat.
    """

    def __init__(self, base_dir: Path | None = None) -> None:
        env_dir = os.environ.get("RECEIPT_STORAGE_DIR")
        if base_dir is not None:
            self._base_dir = base_dir
        elif env_dir:
            self._base_dir = Path(env_dir)
        else:
            self._base_dir = _DEFAULT_LOCAL_DIR

        # Create directory eagerly — cheap if it already exists.
        self._base_dir.mkdir(parents=True, exist_ok=True)
        logger.debug("local_storage.init", base_dir=str(self._base_dir))

    # ReceiptStorage interface ------------------------------------------------

    async def save(self, data: bytes, mime: str, telegram_id: int) -> str:
        """Hash *data* with SHA-256, write to disk, return ``local://`` URI."""
        digest = hashlib.sha256(data).hexdigest()
        ext = _ext_for_mime(mime)
        filename = f"{digest}.{ext}"
        target = self._base_dir / filename
        await asyncio.to_thread(self._write, target, data)
        uri = f"local://{filename}"
        logger.debug("local_storage.save", uri=uri, size=len(data))
        return uri

    async def read(self, uri: str) -> bytes:
        """Read bytes from *uri*.

        Supports ``local://<name>`` and legacy ``file:///path/to/file`` URIs.
        """
        path = self._resolve_uri(uri)
        if not await asyncio.to_thread(path.exists):
            raise FileNotFoundError(f"Receipt file not found: {uri} (resolved: {path})")
        data: bytes = await asyncio.to_thread(path.read_bytes)
        logger.debug("local_storage.read", uri=uri, size=len(data))
        return data

    async def delete(self, uri: str) -> None:
        """Best-effort delete; missing file is a no-op, failures are swallowed (logged)."""
        try:
            path = self._resolve_uri(uri)
            await asyncio.to_thread(path.unlink, True)  # missing_ok=True
            logger.debug("local_storage.delete", uri=uri)
        except Exception as exc:  # noqa: BLE001 — cleanup must not mask the real error
            logger.warning("local_storage.delete_failed", uri=uri, error=str(exc))

    # Legacy FileStorage interface (upload) ----------------------------------

    async def upload(self, file_bytes: bytes, filename: str, mime: str) -> str:
        """Legacy upload interface — delegates to :meth:`save` with telegram_id=0."""
        return await self.save(file_bytes, mime, telegram_id=0)

    # Helpers ----------------------------------------------------------------

    def _resolve_uri(self, uri: str) -> Path:
        """Resolve a storage URI to a filesystem Path."""
        if uri.startswith("local://"):
            filename = uri[len("local://"):]
            return self._base_dir / filename
        if uri.startswith("file://"):
            # Legacy file:// URI — strip scheme and return as-is.
            from urllib.parse import urlparse  # noqa: PLC0415

            parsed = urlparse(uri)
            return Path(parsed.path)
        # Bare filename or relative path — attach to base_dir.
        return self._base_dir / uri

    @staticmethod
    def _write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


# ---------------------------------------------------------------------------
# S3FileStorage — fully implemented, works with MinIO, AWS S3, Yandex OS
# ---------------------------------------------------------------------------


class S3FileStorage:
    """S3-compatible storage backend.

    Works with MinIO (local dev), AWS S3, and Yandex Object Storage using the
    same ``aioboto3`` async client.  Set ``endpoint_url=None`` for AWS S3;
    supply the MinIO / Yandex URL otherwise.

    URI format: ``s3://<bucket>/<key>``

    Non-S3 URIs (``local://``, ``file://``) are transparently delegated to a
    :class:`LocalFileStorage` instance so mixed pipelines don't break.
    """

    def __init__(  # noqa: PLR0913
        self,
        bucket: str,
        endpoint_url: str | None,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        prefix: str = "receipts/",
    ) -> None:
        if not _AIOBOTO3_AVAILABLE:
            raise RuntimeError(
                "aioboto3 is required for S3FileStorage.  "
                "Install it: poetry add aioboto3"
            )
        self._bucket = bucket
        self._endpoint_url = endpoint_url or None  # empty string → None
        self._access_key = access_key
        self._secret_key = secret_key
        self._region = region
        self._prefix = prefix
        # Lazy fallback for non-S3 URIs.
        self._local: LocalFileStorage | None = None
        logger.info(
            "s3_storage.init",
            bucket=bucket,
            endpoint_url=self._endpoint_url,
            prefix=prefix,
        )

    # Minimum part size for S3 multipart upload (5 MiB per S3 spec).
    _MULTIPART_THRESHOLD = 5 * 1024 * 1024  # 5 MiB
    _MULTIPART_CHUNK_SIZE = 5 * 1024 * 1024  # 5 MiB chunks

    # ReceiptStorage interface ------------------------------------------------

    async def save(self, data: bytes, mime: str, telegram_id: int) -> str:
        """Hash *data* with SHA-256, upload to S3, return ``s3://`` URI.

        Files larger than 5 MiB are uploaded via multipart upload
        (``create_multipart_upload`` → chunked ``upload_part`` →
        ``complete_multipart_upload``).  On any part failure,
        ``abort_multipart_upload`` is called to clean up partial uploads.
        """
        digest = hashlib.sha256(data).hexdigest()
        ext = _ext_for_mime(mime)
        key = f"{self._prefix}{digest}.{ext}"
        async with self._make_client() as client:
            if len(data) > self._MULTIPART_THRESHOLD:
                await self._save_multipart(client, key, data, mime)
            else:
                await client.put_object(
                    Bucket=self._bucket,
                    Key=key,
                    Body=data,
                    ContentType=mime,
                )
        uri = f"s3://{self._bucket}/{key}"
        logger.debug("s3_storage.save", uri=uri, size=len(data), multipart=len(data) > self._MULTIPART_THRESHOLD)
        return uri

    async def _save_multipart(self, client, key: str, data: bytes, mime: str) -> None:  # type: ignore[type-arg]
        """Upload *data* to *key* using S3 multipart upload protocol.

        Chunks of ``_MULTIPART_CHUNK_SIZE`` bytes each; the last chunk may be
        smaller.  If any part upload fails, ``abort_multipart_upload`` is
        called to prevent lingering incomplete uploads from incurring storage
        costs.
        """
        upload_id: str | None = None
        try:
            response = await client.create_multipart_upload(
                Bucket=self._bucket,
                Key=key,
                ContentType=mime,
            )
            upload_id = response["UploadId"]
            parts = []
            chunk_size = self._MULTIPART_CHUNK_SIZE
            for part_number, offset in enumerate(range(0, len(data), chunk_size), start=1):
                chunk = data[offset : offset + chunk_size]
                part_response = await client.upload_part(
                    Bucket=self._bucket,
                    Key=key,
                    UploadId=upload_id,
                    PartNumber=part_number,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_number, "ETag": part_response["ETag"]})
                logger.debug(
                    "s3_storage.multipart_part",
                    key=key,
                    part=part_number,
                    size=len(chunk),
                )
            await client.complete_multipart_upload(
                Bucket=self._bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": parts},
            )
            logger.info("s3_storage.multipart_complete", key=key, parts=len(parts), total_bytes=len(data))
        except Exception:
            if upload_id is not None:
                try:
                    await client.abort_multipart_upload(
                        Bucket=self._bucket,
                        Key=key,
                        UploadId=upload_id,
                    )
                    logger.warning("s3_storage.multipart_aborted", key=key, upload_id=upload_id)
                except Exception:
                    logger.exception("s3_storage.multipart_abort_failed", key=key, upload_id=upload_id)
            raise

    # Presigned URL helpers --------------------------------------------------

    async def generate_presigned_get_url(self, uri: str, expires_in: int = 3600) -> str:
        """Generate a presigned GET URL for an existing S3 object.

        Args:
            uri: Storage URI in ``s3://<bucket>/<key>`` format.
            expires_in: Lifetime of the URL in seconds (default: 3600).

        Returns:
            A presigned HTTPS URL that allows anonymous GET access until expiry.

        Note:
            In production, aioboto3 generates a real AWS/MinIO presigned URL.
            In tests, mock ``_make_client`` to capture the call; a real
            presigned URL cannot be generated without valid AWS credentials and
            an active endpoint (requires ``moto`` or a live MinIO instance).
        """
        bucket, key = self._parse_s3_uri(uri)
        async with self._make_client() as client:
            url: str = await client.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=expires_in,
            )
        logger.debug("s3_storage.presigned_get", uri=uri, expires_in=expires_in)
        return url

    async def generate_presigned_post_url(
        self,
        mime: str,
        telegram_id: int,
        expires_in: int = 600,
    ) -> tuple[str, dict, str]:
        """Generate a presigned POST URL for direct browser-to-S3 uploads.

        The key is namespaced by ``telegram_id`` so uploads cannot collide
        across sellers.  The caller receives a ``(url, fields, expected_uri)``
        triple:

        * ``url`` — POST target URL.
        * ``fields`` — form fields to include in the multipart POST body.
        * ``expected_uri`` — the ``s3://`` URI that will be produced after the
          browser finishes uploading (suitable for storing in the DB before the
          upload completes).

        Args:
            mime: MIME type of the file being uploaded (e.g. ``image/jpeg``).
            telegram_id: Seller's Telegram user ID (used for key namespacing).
            expires_in: Lifetime of the presigned POST in seconds (default: 600).

        Returns:
            ``(url, fields, expected_storage_uri)``

        Note:
            In production, aioboto3 generates a real AWS/MinIO presigned POST.
            In tests, mock ``_make_client`` to capture the call; a real
            presigned POST cannot be generated without valid AWS credentials and
            an active endpoint (requires ``moto`` or a live MinIO instance).
        """
        ext = _ext_for_mime(mime)
        import uuid as _uuid  # noqa: PLC0415 — lazy import to avoid top-level dep

        key = f"{self._prefix}{telegram_id}/{_uuid.uuid4().hex}.{ext}"
        expected_uri = f"s3://{self._bucket}/{key}"
        async with self._make_client() as client:
            result: dict = await client.generate_presigned_post(
                self._bucket,
                key,
                Fields={"Content-Type": mime},
                Conditions=[{"Content-Type": mime}],
                ExpiresIn=expires_in,
            )
        url: str = result["url"]
        fields: dict = result["fields"]
        logger.debug("s3_storage.presigned_post", key=key, mime=mime, expires_in=expires_in)
        return url, fields, expected_uri

    # ReceiptStorage interface ------------------------------------------------

    async def read(self, uri: str) -> bytes:
        """Retrieve bytes from *uri*.

        Supports ``s3://`` URIs directly.  ``local://`` and ``file://`` URIs
        are delegated to :class:`LocalFileStorage` so mixed pipelines work.
        """
        if not uri.startswith("s3://"):
            # Delegate non-S3 URIs to local storage.
            return await self._local_fallback().read(uri)

        bucket, key = self._parse_s3_uri(uri)
        async with self._make_client() as client:
            try:
                response = await client.get_object(Bucket=bucket, Key=key)
            except client.exceptions.NoSuchKey:
                raise FileNotFoundError(f"S3 object not found: {uri}") from None
            except Exception as exc:
                # Surface as FileNotFoundError for a clear, consistent error.
                _code = getattr(getattr(exc, "response", {}), "get", lambda *a: None)(
                    "Error", {}
                ).get("Code", "")
                if _code in ("NoSuchKey", "404"):
                    raise FileNotFoundError(f"S3 object not found: {uri}") from exc
                raise
            body: bytes = await response["Body"].read()
        logger.debug("s3_storage.read", uri=uri, size=len(body))
        return body

    async def delete(self, uri: str) -> None:
        """Best-effort delete of an S3 object (or delegate non-S3 URIs to local)."""
        if not uri.startswith("s3://"):
            await self._local_fallback().delete(uri)
            return
        try:
            bucket, key = self._parse_s3_uri(uri)
            async with self._make_client() as client:
                await client.delete_object(Bucket=bucket, Key=key)
            logger.debug("s3_storage.delete", uri=uri)
        except Exception as exc:  # noqa: BLE001 — cleanup must not mask the real error
            logger.warning("s3_storage.delete_failed", uri=uri, error=str(exc))

    # Legacy FileStorage interface (upload) ----------------------------------

    async def upload(self, file_bytes: bytes, filename: str, mime: str) -> str:
        """Legacy upload interface — delegates to :meth:`save` with telegram_id=0."""
        return await self.save(file_bytes, mime, telegram_id=0)

    # Startup helper ---------------------------------------------------------

    async def ensure_bucket(self) -> None:
        """Create the configured bucket if it does not already exist.

        Safe to call on every startup — uses ``head_bucket`` to check first.
        """
        async with self._make_client() as client:
            try:
                await client.head_bucket(Bucket=self._bucket)
                logger.debug("s3_storage.bucket_exists", bucket=self._bucket)
            except Exception:
                await client.create_bucket(Bucket=self._bucket)
                logger.info("s3_storage.bucket_created", bucket=self._bucket)

    # Helpers ----------------------------------------------------------------

    def _make_client(self):  # type: ignore[return]
        """Return an aioboto3 S3 async context manager."""
        import aioboto3  # noqa: PLC0415

        session = aioboto3.Session()
        kwargs: dict = {
            "aws_access_key_id": self._access_key,
            "aws_secret_access_key": self._secret_key,
            "region_name": self._region,
        }
        if self._endpoint_url:
            kwargs["endpoint_url"] = self._endpoint_url
        return session.client("s3", **kwargs)

    @staticmethod
    def _parse_s3_uri(uri: str) -> tuple[str, str]:
        """Parse ``s3://<bucket>/<key>`` → (bucket, key).

        Raises:
            ValueError: If *uri* is not a valid ``s3://`` URI.
        """
        if not uri.startswith("s3://"):
            raise ValueError(f"Not an S3 URI: {uri!r}")
        without_scheme = uri[len("s3://"):]
        slash = without_scheme.find("/")
        if slash == -1:
            raise ValueError(f"S3 URI missing key component: {uri!r}")
        return without_scheme[:slash], without_scheme[slash + 1:]

    def _local_fallback(self) -> LocalFileStorage:
        """Lazy-init a LocalFileStorage for non-S3 URI delegation."""
        if self._local is None:
            self._local = LocalFileStorage()
        return self._local


# ---------------------------------------------------------------------------
# TelegramFileStorage — kept for legacy references; wraps LocalFileStorage
# ---------------------------------------------------------------------------


class TelegramFileStorage:
    """Thin wrapper retained for import compatibility.

    In production the bot would download via ``getFile`` and pass bytes here.
    Now delegates to LocalFileStorage so URIs are real paths, not placeholders.
    """

    def __init__(self) -> None:
        self._local = LocalFileStorage()

    async def upload(self, file_bytes: bytes, filename: str, mime: str) -> str:
        return await self._local.upload(file_bytes, filename, mime)

    async def save(self, data: bytes, mime: str, telegram_id: int) -> str:
        return await self._local.save(data, mime, telegram_id)

    async def read(self, uri: str) -> bytes:
        return await self._local.read(uri)

    async def delete(self, uri: str) -> None:
        await self._local.delete(uri)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def get_receipt_storage() -> LocalFileStorage | S3FileStorage:
    """Return the configured storage backend.

    Controlled by env var ``RECEIPT_STORAGE``:
        ``local`` (default) → :class:`LocalFileStorage`
        ``s3``              → :class:`S3FileStorage` (reads S3_* env vars)

    S3 env vars (all have dev defaults that point at local MinIO):
        S3_BUCKET           — bucket name (default: vliq-receipts)
        S3_ENDPOINT_URL     — MinIO URL or empty for AWS S3 (default: http://localhost:9000)
        S3_ACCESS_KEY       — access key ID (default: minioadmin)
        S3_SECRET_KEY       — secret access key (default: minioadmin)
        S3_REGION           — AWS region (default: us-east-1)
        S3_PREFIX           — key prefix (default: receipts/)
    """
    backend = os.environ.get("RECEIPT_STORAGE", "local").lower()
    if backend == "s3":
        logger.info("receipt_storage.backend", backend="s3")
        return S3FileStorage(
            bucket=os.environ.get("S3_BUCKET", "vliq-receipts"),
            endpoint_url=os.environ.get("S3_ENDPOINT_URL", "http://localhost:9000") or None,
            access_key=os.environ.get("S3_ACCESS_KEY", "minioadmin"),
            secret_key=os.environ.get("S3_SECRET_KEY", "minioadmin"),
            region=os.environ.get("S3_REGION", "us-east-1"),
            prefix=os.environ.get("S3_PREFIX", "receipts/"),
        )
    logger.debug("receipt_storage.backend", backend="local")
    return LocalFileStorage()


def to_viewable_url(file_url: str | None) -> str | None:
    """Rewrite a stored receipt URI into a browser-viewable URL.

    - ``s3://<bucket>/<key>`` → ``<S3_PUBLIC_ENDPOINT or S3_ENDPOINT_URL>/<bucket>/<key>``
      (the dev MinIO bucket is public-read; for a private prod bucket swap this
      to a presigned GET URL via ``S3FileStorage.generate_presigned_get_url``).
    - ``http(s)://…`` → returned unchanged.
    - ``local://…`` / ``qr://inline`` / ``seed://…`` → ``None`` (not a viewable photo).
    """
    if not file_url:
        return None
    if file_url.startswith(("http://", "https://")):
        return file_url
    if file_url.startswith("s3://"):
        base = (
            os.environ.get("S3_PUBLIC_ENDPOINT")
            or os.environ.get("S3_ENDPOINT_URL")
            or "http://localhost:9000"
        ).rstrip("/")
        return f"{base}/{file_url[len('s3://') :]}"
    return None
