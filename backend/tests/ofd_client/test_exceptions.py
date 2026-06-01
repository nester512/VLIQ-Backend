"""Unit tests for OFD exception hierarchy."""

from __future__ import annotations

import pytest
from src.ofd_client.exceptions import (
    OFDBlockedError,
    OFDError,
    OFDNotFoundError,
    OFDRateLimitError,
)


def test_ofd_not_found_error__is_subclass_of_ofd_error():
    assert issubclass(OFDNotFoundError, OFDError)


def test_ofd_blocked_error__is_subclass_of_ofd_error():
    assert issubclass(OFDBlockedError, OFDError)


def test_ofd_rate_limit_error__is_subclass_of_ofd_error():
    assert issubclass(OFDRateLimitError, OFDError)


def test_ofd_error__is_subclass_of_exception():
    assert issubclass(OFDError, Exception)


def test_ofd_not_found_error__can_be_raised_and_caught_as_ofd_error():
    with pytest.raises(OFDError):
        raise OFDNotFoundError("receipt not found")


def test_ofd_blocked_error__can_be_raised_and_caught_as_ofd_error():
    with pytest.raises(OFDError):
        raise OFDBlockedError("blocked")


def test_ofd_rate_limit_error__can_be_raised_and_caught_as_ofd_error():
    with pytest.raises(OFDError):
        raise OFDRateLimitError("rate limited")


def test_ofd_not_found_error__message_preserved():
    msg = "fn=123 fd=456 fp=789"
    exc = OFDNotFoundError(msg)
    assert str(exc) == msg


def test_ofd_errors__not_caught_as_each_other():
    """Sibling exception types must not catch each other."""
    with pytest.raises(OFDBlockedError):
        raise OFDBlockedError("blocked")

    with pytest.raises(OFDNotFoundError):
        raise OFDNotFoundError("not found")
