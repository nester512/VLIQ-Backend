import type { ReceiptStatus } from '@/types/models'

export type StatusKind = 'ok' | 'dg' | 'wn' | 'muted'

/**
 * Single source of truth for receipt status visuals + labels.
 *
 * Per spec (Use cases S3 / FLOW) the seller sees ONLY 4 statuses:
 *   «На проверке» · «Одобрен» · «Отклонён» · «Выплачен».
 * The backend keeps finer internal states (pending / ocr_in_progress /
 * on_review and the legacy, now-unreachable needs_revision) — they ALL collapse
 * to the single seller-facing «На проверке» here. There is no «на доработке».
 */
export const RECEIPT_STATUS: Record<ReceiptStatus, { label: string; short: string; kind: StatusKind }> = {
  pending:         { label: 'На проверке', short: 'Проверка', kind: 'wn' },
  ocr_in_progress: { label: 'На проверке', short: 'Проверка', kind: 'wn' },
  on_review:       { label: 'На проверке', short: 'Проверка', kind: 'wn' },
  needs_revision:  { label: 'На проверке', short: 'Проверка', kind: 'wn' },
  approved:        { label: 'Одобрен',     short: 'Одобрен',  kind: 'ok' },
  paid_out:        { label: 'Выплачен',    short: 'Выплата',  kind: 'ok' },
  rejected:        { label: 'Отклонён',    short: 'Отказ',    kind: 'dg' },
}

/** Statuses that mean "user is waiting on us". */
export const PENDING_STATUSES: readonly ReceiptStatus[] = [
  'pending', 'ocr_in_progress', 'on_review', 'needs_revision',
]

/** Statuses that count toward `approved`. */
export const APPROVED_STATUSES: readonly ReceiptStatus[] = ['approved', 'paid_out']

export function isPendingStatus(s: ReceiptStatus): boolean {
  return PENDING_STATUSES.includes(s)
}

export function isApprovedStatus(s: ReceiptStatus): boolean {
  return APPROVED_STATUSES.includes(s)
}
