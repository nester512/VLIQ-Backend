"""Tests for global exception handlers (H20)."""

from __future__ import annotations

from typing import Annotated

import pytest
from fastapi import FastAPI, Form, UploadFile
from httpx import ASGITransport, AsyncClient
from pydantic_settings import SettingsConfigDict
from src.app.settings import Settings


class _IsolatedSettings(Settings):
    model_config = SettingsConfigDict(env_nested_delimiter="__", extra="ignore", env_file=None)


def _build_bare_app(env: str = "local") -> FastAPI:
    """Build a minimal FastAPI app directly using setup_* functions with controlled cfg."""
    from src.app.main import setup_exception_handlers, setup_middleware

    cfg = _IsolatedSettings(
        JWT_SECRET_SALT="test-salt",
        TG_BOT_TOKEN="test-token",
        env=env,
        postgres={"POSTGRES_URL": "postgresql+asyncpg://u:p@localhost/db"},
    )

    app = FastAPI()
    setup_middleware(app, cfg)
    setup_exception_handlers(app, cfg)

    @app.get("/_test/boom")
    async def boom():
        raise RuntimeError("intentional test error")

    @app.post("/_test/bad-json")
    async def bad_json_endpoint(body: dict):
        return body

    # Mirrors POST /receipts/upload — UploadFile + required Form() field. A
    # missing/invalid form field makes Pydantic raise RequestValidationError
    # whose .body is starlette FormData (not JSON-serializable).
    @app.post("/_test/multipart")
    async def multipart_endpoint(file: UploadFile, brand_id: Annotated[int, Form()]):
        return {"ok": True, "brand_id": brand_id}

    return app


@pytest.mark.asyncio
async def test_validation_error__returns_422_with_envelope(client: AsyncClient):
    """Invalid JSON body on any endpoint → 422 with envelope keys."""
    response = await client.post(
        "/api/v1/auth/tma-verify",
        content=b"not-json-at-all",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body.get("code") == "VALIDATION_ERROR"
    assert "user_message" in body
    assert "debug_id" in body


@pytest.mark.asyncio
async def test_validation_error__multipart_formdata__returns_422_not_500():
    """Multipart request missing a required Form field → 422 envelope, NOT 500.

    Regression guard: ``exc.body`` / ``exc.errors()['input']`` is starlette
    FormData on multipart requests, which json.dumps could not serialize, so
    the handler crashed with 500 and masked the real validation error (the
    bug seen on POST /receipts/upload). Asserts the handler now emits a clean
    422 envelope with JSON-serializable details.
    """
    app = _build_bare_app(env="local")

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as ac:
        # Send the file but OMIT the required `brand_id` form field.
        response = await ac.post(
            "/_test/multipart",
            files={"file": ("receipt.jpg", b"\xff\xd8\xff\xe0", "image/jpeg")},
        )

    assert response.status_code == 422, response.text
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "user_message" in body
    assert "debug_id" in body
    # Localized field errors only — no raw Pydantic English `msg`, no `body`/FormData leak.
    assert isinstance(body["field_errors"], dict)
    assert body["field_errors"], "expected at least one field error"
    assert "brand_id" in body["field_errors"]
    # No English / raw exception text leaks to the client.
    joined = (response.text or "").lower()
    assert "field required" not in joined
    assert "traceback" not in body
    assert "errors" not in body


@pytest.mark.asyncio
async def test_unhandled_exception__prod_env__no_traceback():
    """In prod env, internal 500 must not expose traceback."""
    app = _build_bare_app(env="prod")

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as ac:
        response = await ac.get("/_test/boom")

    assert response.status_code == 500
    body = response.json()
    assert "traceback" not in body
    assert body.get("code") == "INTERNAL_ERROR"
    assert "user_message" in body
    assert "debug_id" in body


@pytest.mark.asyncio
async def test_unhandled_exception__local_env__still_no_traceback():
    """Even in local/dev env, an internal 500 must NOT leak a traceback or raw
    exception text to the client (§12 security) — only the envelope + debug_id."""
    app = _build_bare_app(env="local")

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as ac:
        response = await ac.get("/_test/boom")

    assert response.status_code == 500
    body = response.json()
    assert body.get("code") == "INTERNAL_ERROR"
    assert "user_message" in body
    assert "debug_id" in body
    assert "traceback" not in body
    assert "RuntimeError" not in response.text
    assert "intentional test error" not in response.text
