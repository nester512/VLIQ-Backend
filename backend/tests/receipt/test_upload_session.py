"""Unit tests for signed upload-session tokens.

    test_roundtrip__returns_keys
    test_wrong_seller__raises
    test_tampered_token__raises
    test_not_a_session_token__raises
"""

from __future__ import annotations

import pytest
from src.receipt.upload_session import (
    UploadSessionError,
    sign_upload_session,
    verify_upload_session,
)


def test_roundtrip__returns_keys() -> None:
    keys = ["s3://b/receipts/1/a.jpg", "s3://b/receipts/1/b.pdf"]
    token = sign_upload_session(seller_id=1, keys=keys)
    assert verify_upload_session(token, seller_id=1) == keys


def test_wrong_seller__raises() -> None:
    token = sign_upload_session(seller_id=1, keys=["s3://b/receipts/1/a.jpg"])
    with pytest.raises(UploadSessionError):
        verify_upload_session(token, seller_id=2)


def test_tampered_token__raises() -> None:
    token = sign_upload_session(seller_id=1, keys=["s3://b/receipts/1/a.jpg"])
    tampered = token[:-3] + ("aaa" if not token.endswith("aaa") else "bbb")
    with pytest.raises(UploadSessionError):
        verify_upload_session(tampered, seller_id=1)


def test_not_a_session_token__raises() -> None:
    # A normal JWT (auth token) is signed with the same secret but typ != upload_session.
    from unittest.mock import MagicMock  # noqa: PLC0415

    from src.app.auth.jwt import jwt_auth  # noqa: PLC0415
    from src.seller.models import Seller  # noqa: PLC0415

    seller = MagicMock(spec=Seller)
    seller.telegram_id = 1
    auth_token = jwt_auth.create_token(seller)
    with pytest.raises(UploadSessionError):
        verify_upload_session(auth_token, seller_id=1)
