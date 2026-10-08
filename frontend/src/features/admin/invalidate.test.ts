import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidateAfterPayoutChange, invalidateAfterReceiptChange } from './invalidate'

function keys(fn: (qc: QueryClient) => void) {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  fn(qc)
  return spy.mock.calls.map(([f]) => (f as { queryKey: string[] }).queryKey.join('/')).sort()
}

describe('admin cache invalidation', () => {
  it('a receipt change refreshes every receipt-dependent view', () => {
    expect(keys((qc) => invalidateAfterReceiptChange(qc))).toEqual(
      ['admin/dashboard', 'admin/receipts', 'admin/review-queue', 'admin/seller-detail', 'admin/seller-receipts', 'admin/sellers'],
    )
  })

  it('a deck swipe leaves the deck queue alone (no mid-session reshuffle)', () => {
    expect(keys((qc) => invalidateAfterReceiptChange(qc, { reviewQueue: false }))).not.toContain('admin/review-queue')
  })

  it('a payout change also refreshes the seller card (balance / paid out)', () => {
    expect(keys(invalidateAfterPayoutChange)).toEqual(['admin/dashboard', 'admin/payouts', 'admin/seller-detail'])
  })
})
