"""Unit tests for to_viewable_url — stored URI → browser-viewable URL."""

from __future__ import annotations

from src.receipt_ocr.image_token import verify_image_uri
from src.receipt_ocr.storage import to_viewable_url


def test_s3_uri_becomes_signed_same_origin_proxy_url() -> None:
    uri = "s3://vliq-receipts/receipts/abc.jpg"
    url = to_viewable_url(uri)
    assert url is not None
    assert url.startswith("/api/v1/receipts/attachments/file?sig=")
    # The embedded signature verifies back to the original storage URI.
    assert verify_image_uri(url.split("sig=", 1)[1]) == uri


def test_http_and_https_urls_pass_through_unchanged() -> None:
    assert to_viewable_url("https://cdn.example/x.jpg") == "https://cdn.example/x.jpg"
    assert to_viewable_url("http://cdn.example/x.jpg") == "http://cdn.example/x.jpg"


def test_non_viewable_schemes_return_none() -> None:
    assert to_viewable_url("seed://r1.jpg") is None
    assert to_viewable_url("local://abc.jpg") is None
    assert to_viewable_url("qr://inline") is None


def test_empty_or_none_returns_none() -> None:
    assert to_viewable_url(None) is None
    assert to_viewable_url("") is None
