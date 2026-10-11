/**
 * One set of sorts for every admin receipt history («Все чеки», a seller's «История чеков»),
 * kept in the URL (`?sort=`) so «назад» and a reload keep it. Default — newest first.
 */
export type ReceiptSortKey = 'new' | 'old' | 'sum' | 'bonus'

export const RECEIPT_SORT_PILLS: Array<{ value: ReceiptSortKey; label: string }> = [
  { value: 'new', label: 'Сначала новые' },
  { value: 'old', label: 'Сначала старые' },
  { value: 'sum', label: 'Дороже' },
  { value: 'bonus', label: 'Больше бонус' },
]

export const RECEIPT_SORT_QUERY: Record<ReceiptSortKey, { sort: 'created' | 'total_sum' | 'bonus'; order: 'asc' | 'desc' }> = {
  new: { sort: 'created', order: 'desc' },
  old: { sort: 'created', order: 'asc' },
  sum: { sort: 'total_sum', order: 'desc' },
  bonus: { sort: 'bonus', order: 'desc' },
}

export function parseReceiptSort(value: string | null): ReceiptSortKey {
  return RECEIPT_SORT_PILLS.some((p) => p.value === value) ? (value as ReceiptSortKey) : 'new'
}
