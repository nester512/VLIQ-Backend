"""Unit tests for ReceiptStateMachine."""

from __future__ import annotations

import pytest
from src.receipt_pipeline.state_machine import ReceiptStateMachine


@pytest.fixture(scope="module")
def sm() -> ReceiptStateMachine:
    return ReceiptStateMachine()


# ---------------------------------------------------------------------------
# Valid transitions (happy path)
# ---------------------------------------------------------------------------


class TestValidTransitions:
    def test_pending_to_ocr_in_progress__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="pending", to_status="ocr_in_progress", actor="system") is True

    def test_pending_to_on_review__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="pending", to_status="on_review", actor="system") is True

    def test_ocr_in_progress_to_needs_revision__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="ocr_in_progress", to_status="needs_revision", actor="system") is True

    def test_ocr_in_progress_to_on_review__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="ocr_in_progress", to_status="on_review", actor="system") is True

    def test_ocr_in_progress_to_rejected__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="ocr_in_progress", to_status="rejected", actor="system") is True

    def test_ocr_in_progress_to_approved__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="ocr_in_progress", to_status="approved", actor="system") is True

    def test_needs_revision_to_ocr_in_progress__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="needs_revision", to_status="ocr_in_progress", actor="system") is True

    def test_needs_revision_to_rejected__admin(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="needs_revision", to_status="rejected", actor="admin") is True

    def test_on_review_to_approved__admin(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="on_review", to_status="approved", actor="admin") is True

    def test_on_review_to_rejected__admin(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="on_review", to_status="rejected", actor="admin") is True

    def test_on_review_to_ocr_in_progress__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="on_review", to_status="ocr_in_progress", actor="system") is True

    def test_approved_to_paid_out__system(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="approved", to_status="paid_out", actor="system") is True

    def test_approved_to_rejected__admin(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="approved", to_status="rejected", actor="admin") is True


# ---------------------------------------------------------------------------
# Invalid transitions
# ---------------------------------------------------------------------------


class TestInvalidTransitions:
    def test_pending_to_approved__system__not_allowed(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="pending", to_status="approved", actor="system") is False

    def test_pending_to_rejected__admin__not_allowed(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="pending", to_status="rejected", actor="admin") is False

    def test_approved_to_paid_out__admin__wrong_actor(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="approved", to_status="paid_out", actor="admin") is False

    def test_needs_revision_to_rejected__system__wrong_actor(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="needs_revision", to_status="rejected", actor="system") is False

    def test_on_review_to_approved__system__wrong_actor(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="on_review", to_status="approved", actor="system") is False

    def test_seller__never_allowed(self, sm: ReceiptStateMachine):
        # Sellers have no transitions in the state machine.
        assert sm.can_transition(from_status="pending", to_status="ocr_in_progress", actor="seller") is False
        assert sm.can_transition(from_status="on_review", to_status="approved", actor="seller") is False

    def test_nonexistent_status_pair__returns_false(self, sm: ReceiptStateMachine):
        assert sm.can_transition(from_status="approved", to_status="pending", actor="system") is False


# ---------------------------------------------------------------------------
# allowed_next
# ---------------------------------------------------------------------------


class TestAllowedNext:
    def test_allowed_next__pending__system(self, sm: ReceiptStateMachine):
        nexts = sm.allowed_next(from_status="pending", actor="system")
        assert set(nexts) >= {"ocr_in_progress", "on_review"}

    def test_allowed_next__on_review__admin(self, sm: ReceiptStateMachine):
        nexts = sm.allowed_next(from_status="on_review", actor="admin")
        assert set(nexts) == {"approved", "rejected"}

    def test_allowed_next__paid_out__system__empty(self, sm: ReceiptStateMachine):
        nexts = sm.allowed_next(from_status="paid_out", actor="system")
        assert nexts == []
