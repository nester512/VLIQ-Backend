import type { QueryClient } from '@tanstack/react-query'

/**
 * One place that knows which admin views depend on a receipt. Call sites used to
 * list query keys by hand and each missed some (the seller list kept old counters
 * and risk, the «Все чеки» archive kept old statuses, the dashboard kept old totals).
 *
 * `reviewQueue: false` for swipes from the deck itself: the deck hides the actioned
 * card locally and deliberately avoids mid-session refetches of its own queue.
 */
export function invalidateAfterReceiptChange(qc: QueryClient, { reviewQueue = true } = {}) {
  void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
  void qc.invalidateQueries({ queryKey: ['admin', 'sellers'] })
  void qc.invalidateQueries({ queryKey: ['admin', 'seller-detail'] })
  void qc.invalidateQueries({ queryKey: ['admin', 'seller-receipts'] })
  void qc.invalidateQueries({ queryKey: ['admin', 'receipts'] })
  if (reviewQueue) void qc.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
}

/** A payout request changed: lists, dashboard and the seller card (balance / paid out / on hold). */
export function invalidateAfterPayoutChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['admin', 'payouts'] })
  void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
  void qc.invalidateQueries({ queryKey: ['admin', 'seller-detail'] })
}
