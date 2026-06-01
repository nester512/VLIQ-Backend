import type { ReceiptStatus } from '@/types/models'

export type StatusKind = 'ok' | 'dg' | 'wn' | 'muted'

/**
 * Single source of truth for receipt status visuals + labels.
 * Backend statuses: pending, ocr_in_progress, on_review, approved,
 *                   rejected, needs_revision, paid_out.
 */
export const RECEIPT_STATUS: Record<ReceiptStatus, { label: string; short: string; kind: StatusKind }> = {
  pending:         { label: 'Принят',           short: 'Принят',     kind: 'wn' },
  ocr_in_progress: { label: 'Распознаётся',     short: 'OCR',         kind: 'wn' },
  on_review:       { label: 'На проверке',       short: 'Проверка',    kind: 'wn' },
  needs_revision:  { label: 'Нужны правки',     short: 'Правки',      kind: 'wn' },
  approved:        { label: 'Одобрен',           short: 'Одобрен',     kind: 'ok' },
  paid_out:        { label: 'Выплачен',          short: 'Выплата',     kind: 'ok' },
  rejected:        { label: 'Отклонён',          short: 'Отказ',       kind: 'dg' },
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
