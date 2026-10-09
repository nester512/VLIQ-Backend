import type { ReactNode } from 'react'
import { fmtMoney } from '@/utils/formatMoney'
import { lineTotal, qtyLabel } from '@/utils/receiptItems'
import type { ReceiptItem } from '@/types/models'

interface ReceiptItemsProps {
  items?: ReceiptItem[]
  /** Show at most this many lines, then «ещё N товаров» (the decision card). */
  max?: number
  /** What to show while the check source has not returned the composition yet. */
  empty?: ReactNode
}

/**
 * «Состав чека» — products from the check source's answer (ФНС / ОФД). QR intake
 * sends no photo, so this list is what replaces «look at the picture».
 */
export function ReceiptItems({ items, max, empty }: ReceiptItemsProps) {
  const list = items ?? []
  if (list.length === 0) return <>{empty ?? null}</>
  const shown = max != null ? list.slice(0, max) : list
  const rest = list.length - shown.length
  return (
    <ul data-testid="receipt-items" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
      {shown.map((it, i) => (
        <li key={`${it.name}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, lineHeight: 1.3 }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: 'var(--vliq-text)', fontWeight: 600 }}>
            {it.name} <span style={{ color: 'var(--vliq-hint)', fontWeight: 600 }}>{qtyLabel(it)}</span>
          </span>
          <span style={{ flex: 'none', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--vliq-text)' }}>
            {fmtMoney(lineTotal(it))}
          </span>
        </li>
      ))}
      {rest > 0 && (
        <li style={{ fontSize: 12.5, color: 'var(--vliq-hint)', fontWeight: 600 }}>ещё {rest} — в «Подробнее»</li>
      )}
    </ul>
  )
}
