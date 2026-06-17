import { Icon } from '@/components/atoms/Icon'
import { fmtMoneyDelta } from '@/utils/formatMoney'
import type { BonusTransaction } from '@/types/models'

interface AccrualRowProps {
  transaction: BonusTransaction
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(new Date(iso))
}

export function AccrualRow({ transaction }: AccrualRowProps) {
  const isPayout = transaction.type === 'payout'
  // Money is stored in KOPECKS — fmtMoneyDelta divides by 100, adds the ₽ and a
  // +/− sign from the amount's own sign (was rendering raw kopecks: "10000 ₽").
  const amountStr = fmtMoneyDelta(transaction.amount)
  const desc = transaction.description ?? (isPayout ? 'Выплата' : 'Начисление бонуса')
  const sub = [
    formatDate(transaction.created_at),
    transaction.receipt_id ? `чек #${transaction.receipt_id}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="vliq-row is-static">
      <div
        className={[
          'vliq-row-ic',
          isPayout
            ? 'bg-[var(--vliq-field)] text-[var(--vliq-hint)]'
            : 'bg-[var(--vliq-ok-bg)] text-[var(--vliq-ok-ink)]',
        ].join(' ')}
      >
        <Icon name={isPayout ? 'cashout' : 'gift'} size={21} />
      </div>
      <div className="vliq-row-tx">
        <b>{desc}</b>
        <span>{sub}</span>
      </div>
      {/* Use .vliq-row-amount for stable truncation near the card's rounded corner */}
      <div
        className="vliq-row-amount"
        style={{ color: isPayout ? 'var(--vliq-text)' : 'var(--vliq-ok-ink)' }}
        title={amountStr}
      >
        {amountStr}
      </div>
    </div>
  )
}
