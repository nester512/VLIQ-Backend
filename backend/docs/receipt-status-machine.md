# Receipt Status State Machine

## Status Values

| Value | Description |
|-------|-------------|
| `pending` | Uploaded, waiting for pipeline worker to pick up |
| `ocr_in_progress` | Worker running: QR extraction → OFD call |
| `on_review` | Manual admin review required |
| `needs_revision` | Seller must resubmit (unclear QR, OFD unreachable) |
| `approved` | All checks passed; bonus accrued |
| `rejected` | Duplicate / fraud detected; not eligible for bonus |
| `paid_out` | Bonus paid out to seller |

## ASCII Diagram

```
                     ┌──────────────────────────────────────────────────────────┐
                     │ system: all checks passed                                │
                     ▼                                                          │
 [pending] ──system──► [ocr_in_progress] ──────────────────────────► [approved] ──system──► [paid_out]
                              │                                          │
                              │ system: QR unreadable /                  │ admin: cancellation
                              │ OFD upstream unavailable                 ▼
                              ▼                                       [rejected]
                       [needs_revision] ──admin──────────────────────────►
                              │
                              │ system: moderation retry
                              └──────────────► [ocr_in_progress]
                              │
                              │ system: duplicate / ФНС not found /
                              │ cross-seller fraud
                              ▼
                          [rejected]

                 [ocr_in_progress] ──system──► [on_review]  (OFD blocked / SKU mismatch / sum mismatch)
                                                   │
                                     admin: approve│           admin: reject
                                                   ├──────────────────────► [approved]
                                                   └──────────────────────► [rejected]
                                                   │
                                     system: OFD retry after unblock
                                                   └──────────────────────► [ocr_in_progress]
```

## Transitions

| From | To | Actor | Trigger |
|------|----|-------|---------|
| `pending` | `ocr_in_progress` | system | Worker picks up receipt |
| `pending` | `on_review` | system | Pre-check fraud signal before QR parse |
| `ocr_in_progress` | `needs_revision` | system | QR unreadable; OFD upstream unavailable after all retries |
| `ocr_in_progress` | `on_review` | system | OFD blocked / SKU 0 matches / QR–OFD sum mismatch / cross-seller dup |
| `ocr_in_progress` | `rejected` | system | Duplicate QR / duplicate fn+fd+fp / date too old / FNS not found |
| `ocr_in_progress` | `approved` | system | All checks passed, bonus calculated |
| `needs_revision` | `ocr_in_progress` | system | Seller resubmitted or admin triggered retry |
| `needs_revision` | `rejected` | admin | Admin manually rejects after review |
| `on_review` | `approved` | admin | Admin confirms receipt is valid |
| `on_review` | `rejected` | admin | Admin rejects after manual check |
| `on_review` | `ocr_in_progress` | system | OFD provider unblocked; automatic retry |
| `approved` | `paid_out` | system | Payout job successfully disbursed bonus |
| `approved` | `rejected` | admin | Admin cancels approved receipt (with reason) |

## `rejection_reason` Machine-Readable Codes

The `rejection_reason` column stores a human-readable message for admin UI.
Pipeline step errors also produce these well-known codes (searched by alerting):

| Code | Set by | Meaning |
|------|--------|---------|
| `OFD_UPSTREAM_UNAVAILABLE` | orchestrator retry exhaustion | OFD provider did not respond after all retry attempts |
| `QR string is missing …` | qr_parser | QR payload malformed |
| `Receipt not found in OFD: …` | ofd_fetch step | FNS returned no record for this fn/fd/fp |
| `QR sum … != OFD sum …` | verify_qr_vs_ofd step | Sum deviation > 1% |

## Implementation References

- State transition table: `src/receipt_pipeline/state_machine.py`
- Transition enforcement: `ReceiptStateMachine.can_transition()`
- Orchestrator step flow: `src/receipt_pipeline/orchestrator.py` `ReceiptPipelineOrchestrator.process()`
- Status enum: `src/receipt/models.py` `ReceiptStatus`
