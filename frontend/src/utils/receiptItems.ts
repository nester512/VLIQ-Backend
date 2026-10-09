import type { ReceiptItem } from '@/types/models'

const qtyOf = (it: ReceiptItem) => (typeof it.qty === 'number' && Number.isFinite(it.qty) && it.qty > 0 ? it.qty : 1)

/** Line sum, kopecks: the stored price is per unit (OFD / ФНС answer). */
export const lineTotal = (it: ReceiptItem) => Math.round(it.price * qtyOf(it))

export const qtyLabel = (it: ReceiptItem) => {
  const q = qtyOf(it)
  return Number.isInteger(q) ? `×${q}` : `×${q.toLocaleString('ru-RU', { maximumFractionDigits: 3 })}`
}

/** One line for list rows: «SWONQ L18000 ×2 · Картридж ×1 · ещё 3». */
export function itemsSummary(items: ReceiptItem[] | undefined, max = 2): string | null {
  const list = (items ?? []).filter((it) => it.name && it.name !== '—')
  if (list.length === 0) return null
  const shown = list.slice(0, max).map((it) => `${it.name} ${qtyLabel(it)}`)
  return list.length > max ? `${shown.join(' · ')} · ещё ${list.length - max}` : shown.join(' · ')
}
