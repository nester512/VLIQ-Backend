import { describe, it, expect } from 'vitest'
import { RECEIPT_STATUS } from './receiptStatus'

/**
 * KAN-18 regression: the «Отклонён» status chip must render red (danger),
 * never green. RECEIPT_STATUS is the single source of truth for every status
 * chip (ReceiptInfoCard, SellerReceiptsPage, seller history) — locking the
 * kind here locks the color everywhere.
 */
describe('RECEIPT_STATUS visual kinds', () => {
  it('rejected is danger (red), not ok (green)', () => {
    expect(RECEIPT_STATUS.rejected.kind).toBe('dg')
    expect(RECEIPT_STATUS.rejected.label).toBe('Отклонён')
  })

  it('positive terminal statuses are ok (green)', () => {
    expect(RECEIPT_STATUS.approved.kind).toBe('ok')
    expect(RECEIPT_STATUS.paid_out.kind).toBe('ok')
  })

  it('waiting statuses are warning (yellow)', () => {
    expect(RECEIPT_STATUS.pending.kind).toBe('wn')
    expect(RECEIPT_STATUS.on_review.kind).toBe('wn')
  })
})
