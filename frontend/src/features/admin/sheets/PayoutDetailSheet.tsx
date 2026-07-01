import { Icon } from '@/components/atoms/Icon'
import { Spinner } from '@/components/atoms/Spinner'
import { KVRow } from '@/components/molecules/KVRow'
import { fmtMoney } from '@/utils/formatMoney'
import { usePayoutActions } from '@/features/admin/hooks/usePayoutsList'
import type { PayoutRequest } from '@/types/models'

const PAYOUT_STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В обработке',
  paid: 'Выплачена',
  rejected: 'Отклонена',
}

const METHOD_LABEL: Record<string, string> = {
  sbp_phone: 'СБП · телефон',
  sbp_bank: 'СБП · банк',
  card: 'Карта',
}

interface PayoutDetailSheetProps {
  payoutId: string | null
  payout?: PayoutRequest
}

export function PayoutDetailSheet({ payoutId, payout }: PayoutDetailSheetProps) {
  const { approve, reject } = usePayoutActions()

  if (!payout || !payoutId) {
    return (
      <div className="vliq-pad" style={{ padding: '48px 16px', display: 'grid', placeItems: 'center' }}>
        <Spinner size={28} className="text-[var(--vliq-brand)]" />
      </div>
    )
  }

  const statusLabel = PAYOUT_STATUS_LABEL[payout.status] ?? payout.status
  const methodLabel = METHOD_LABEL[payout.method] ?? payout.method
  const sellerLabel = payout.seller_name?.trim() || `Продавец #${payout.seller_id}`
  const isAnyPending = approve.isPending || reject.isPending
  // Only `new` and `in_progress` are actionable — `paid` and `rejected` are
  // terminal. Hide the buttons rather than gracefully 422-ing on the backend.
  const isActionable = payout.status === 'new' || payout.status === 'in_progress'

  return (
    <div className="vliq-pad" style={{ paddingTop: 6, paddingBottom: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 4, marginBottom: 16, color: 'var(--vliq-text)' }}>
        Заявка на выплату
      </h2>

      <div className="vliq-card" style={{ padding: '0 16px', marginBottom: 16 }}>
        <KVRow label="Продавец"  value={sellerLabel} />
        {payout.seller_store && <KVRow label="Точка" value={payout.seller_store} />}
        <KVRow label="Сумма"     value={fmtMoney(payout.amount)} valueStyle={{ fontSize: 15 }} />
        <KVRow label="Способ"    value={methodLabel} />
        <KVRow label="Реквизиты" value={payout.details ?? '—'} />
        <KVRow label="Статус"    value={statusLabel} />
      </div>

      {/* Antifraud banner — TODO: replace with real signal once backend exposes it */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          borderRadius: 14,
          padding: '12px 16px',
          marginBottom: 20,
          background: 'var(--vliq-ok-bg)',
          color: 'var(--vliq-ok-ink)',
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        <Icon name="shield" size={16} className="flex-none" />
        <span>Антифрод: подозрительной активности не выявлено. Лимиты не превышены.</span>
      </div>

      {isActionable ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            type="button"
            disabled={isAnyPending}
            onClick={() => approve.mutate(payoutId)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: 12, borderRadius: 14, fontSize: 13, fontWeight: 700,
              background: 'var(--vliq-ok-bg)', color: 'var(--vliq-ok-ink)',
              border: 0, cursor: isAnyPending ? 'not-allowed' : 'pointer',
              opacity: isAnyPending ? 0.5 : 1,
            }}
          >
            <Icon name="check" size={18} />
            Подтвердить
          </button>
          <button
            type="button"
            disabled={isAnyPending}
            onClick={() => reject.mutate(payoutId)}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: 12, borderRadius: 14, fontSize: 13, fontWeight: 700,
              background: 'var(--vliq-dg-bg)', color: 'var(--vliq-dg-ink)',
              border: 0, cursor: isAnyPending ? 'not-allowed' : 'pointer',
              opacity: isAnyPending ? 0.5 : 1,
            }}
          >
            <Icon name="x" size={18} />
            Отклонить
          </button>
        </div>
      ) : (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 14,
            background: 'var(--vliq-field)',
            color: 'var(--vliq-hint)',
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          Заявка завершена — действия недоступны
        </div>
      )}
    </div>
  )
}
