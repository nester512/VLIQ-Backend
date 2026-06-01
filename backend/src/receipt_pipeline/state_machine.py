"""Receipt state machine — allowed transitions per actor type.

Transitions (from OCR plan § 6):

  pending          → ocr_in_progress          (system)
  ocr_in_progress  → needs_revision           (system: QR unreadable)
  ocr_in_progress  → on_review               (system: OFD blocked / SKU mismatch / sum mismatch)
  ocr_in_progress  → rejected                (system: duplicate / ФНС not found)
  ocr_in_progress  → approved                (system: all checks passed)
  needs_revision   → ocr_in_progress         (system: moderation retry)
  needs_revision   → rejected                (admin)
  on_review        → approved                (admin)
  on_review        → rejected                (admin)
  on_review        → needs_revision          (admin: send back for rework)
  on_review        → ocr_in_progress         (system: OFD retry after unblock)
  approved         → paid_out               (system: payout completed)
  approved         → rejected               (admin: cancellation with reason)
"""

from __future__ import annotations

from src.receipt.models import ReceiptStatus

# actor_type literals — mirrors AuditLog.ActorType values.
ActorType = str  # "system" | "admin" | "seller"

# Mapping: (from_status, to_status) → set of allowed actors.
_TRANSITIONS: dict[tuple[str, str], frozenset[str]] = {
    (ReceiptStatus.pending.value, ReceiptStatus.on_review.value): frozenset({"system"}),
    (ReceiptStatus.pending.value, "ocr_in_progress"): frozenset({"system"}),
    ("ocr_in_progress", ReceiptStatus.needs_revision.value): frozenset({"system"}),
    ("ocr_in_progress", ReceiptStatus.on_review.value): frozenset({"system"}),
    ("ocr_in_progress", ReceiptStatus.rejected.value): frozenset({"system"}),
    ("ocr_in_progress", ReceiptStatus.approved.value): frozenset({"system"}),
    (ReceiptStatus.needs_revision.value, "ocr_in_progress"): frozenset({"system"}),
    (ReceiptStatus.needs_revision.value, ReceiptStatus.rejected.value): frozenset({"admin"}),
    (ReceiptStatus.on_review.value, ReceiptStatus.approved.value): frozenset({"admin"}),
    (ReceiptStatus.on_review.value, ReceiptStatus.rejected.value): frozenset({"admin"}),
    (ReceiptStatus.on_review.value, ReceiptStatus.needs_revision.value): frozenset({"admin"}),
    (ReceiptStatus.on_review.value, "ocr_in_progress"): frozenset({"system"}),
    (ReceiptStatus.approved.value, ReceiptStatus.paid_out.value): frozenset({"system"}),
    (ReceiptStatus.approved.value, ReceiptStatus.rejected.value): frozenset({"admin"}),
}


class ReceiptStateMachine:
    """Encapsulates allowed receipt status transitions.

    Usage::

        sm = ReceiptStateMachine()
        if sm.can_transition("pending", "ocr_in_progress", "system"):
            ...  # proceed
    """

    def can_transition(self, *, from_status: str, to_status: str, actor: ActorType) -> bool:
        """Return True if the transition is allowed for the given actor."""
        allowed_actors = _TRANSITIONS.get((from_status, to_status))
        return allowed_actors is not None and actor in allowed_actors

    def allowed_next(self, *, from_status: str, actor: ActorType) -> list[str]:
        """Return all statuses reachable from *from_status* for the given *actor*."""
        return [
            to_status
            for (from_s, to_status), actors in _TRANSITIONS.items()
            if from_s == from_status and actor in actors
        ]
