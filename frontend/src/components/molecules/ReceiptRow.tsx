import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { RECEIPT_STATUS, isApprovedStatus, type StatusKind } from '@/utils/receiptStatus'
import { fmtMoneyDelta } from '@/utils/formatMoney'
import type { Receipt } from '@/types/models'

const ICON_BG: Record<StatusKind, string> = {
  ok:    'bg-[var(--vliq-ok-bg)] text-[var(--vliq-ok-ink)]',
  dg:    'bg-[var(--vliq-dg-bg)] text-[var(--vliq-dg-ink)]',
  wn:    'bg-[var(--vliq-wn-bg)] text-[var(--vliq-wn-ink)]',
  muted: 'bg-[var(--vliq-field)] text-[var(--vliq-hint)]',
}

interface ReceiptRowProps {
  receipt: Receipt
  onClick: () => void
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function ReceiptRow({ receipt, onClick }: ReceiptRowProps) {
  const cfg = RECEIPT_STATUS[receipt.status]
  // `short` label keeps the trailing pill nowrap-safe at 320px screen widths.
  const label = cfg?.short ?? receipt.status
  const kind: StatusKind = cfg?.kind ?? 'muted'
  const bonusOk = isApprovedStatus(receipt.status) && (receipt.bonus_amount ?? 0) > 0
  const bonusText = bonusOk ? fmtMoneyDelta(receipt.bonus_amount ?? 0) : '—'

  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <div className={`vliq-row-ic ${ICON_BG[kind]}`}>
        <Icon name="receipt" size={21} />
      </div>
      <div className="vliq-row-tx">
        <b>Чек #{receipt.id}</b>
        <span>{formatDate(receipt.created_at)}</span>
      </div>
      {/* Trailing: amount + pill — max-width prevents the pill from escaping the card corner */}
      <div style={{ flex: 'none', textAlign: 'right', maxWidth: 120, minWidth: 0, overflow: 'hidden' }}>
        <div
          className="vliq-tabnum"
          style={{
            fontWeight: 800,
            fontSize: 14,
            color: bonusOk ? 'var(--vliq-ok-ink)' : 'var(--vliq-hint)',
            whiteSpace: 'nowrap',
          }}
        >
          {bonusText}
        </div>
        <Pill kind={kind} className="mt-1">{label}</Pill>
      </div>
    </button>
  )
}
