import { useState } from 'react'
import { Icon } from '@/components/atoms/Icon'
import { Spinner } from '@/components/atoms/Spinner'
import { KVRow } from '@/components/molecules/KVRow'
import { RejectReasonSheet } from '@/components/molecules/RejectReasonSheet'
import { fmtMoney } from '@/utils/formatMoney'
import { formatDate, formatDateTime } from '@/utils/formatDate'
import { usePayoutActions, usePayoutReceipts } from '@/features/admin/hooks/usePayoutsList'
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

const RECEIPT_STATUS_LABEL: Record<string, string> = {
  approved: 'Одобрен',
  paid_out: 'Выплачен',
  rejected: 'Отклонён',
}

const REJECT_COPY = {
  title: 'Причина отказа',
  note: 'Продавец увидит причину в «Мои заявки» и в уведомлении; сумма вернётся на его баланс.',
  placeholder: 'Почему заявка отклоняется…',
  confirmLabel: 'Отклонить',
  submittingLabel: 'Отклонение…',
  quickPicks: ['Неверный номер телефона', 'Номер не подключён к СБП', 'Проверка продавца'],
} as const

const btn = (bg: string, color: string, busy: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: 12, borderRadius: 14, fontSize: 13, fontWeight: 700, minWidth: 0,
  background: bg, color, border: 0, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1,
})

interface PayoutDetailSheetProps {
  payoutId: string | null
  payout?: PayoutRequest
}

/**
 * A payout request (BRD A3): who, how much, where to — the receipts it covers —
 * and the actions «Взять в работу» → «Выплачено» (with the bank's transaction id)
 * or «Отклонить» (reason required, the seller sees it).
 */
export function PayoutDetailSheet({ payoutId, payout: initial }: PayoutDetailSheetProps) {
  const [payout, setPayout] = useState(initial)
  const [txnId, setTxnId] = useState('')
  const [rejectOpen, setRejectOpen] = useState(false)
  const { take, approve, reject } = usePayoutActions(setPayout)
  const { data: covered, isLoading: coveredLoading } = usePayoutReceipts(payoutId)

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
  const busy = take.isPending || approve.isPending || reject.isPending
  const isActionable = payout.status === 'new' || payout.status === 'in_progress'
  // No money goes out to a blocked seller; refusing (money back to the balance) stays possible.
  const blocked = payout.seller_status === 'blocked'

  return (
    <div className="vliq-pad" style={{ paddingTop: 6, paddingBottom: 16 }} data-testid="payout-detail">
      <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 4, marginBottom: 16, color: 'var(--vliq-text)' }}>
        Заявка на выплату #{payout.id}
      </h2>

      <div className="vliq-card" style={{ padding: '0 16px', marginBottom: 16 }}>
        <KVRow label="Продавец" value={sellerLabel} />
        {payout.seller_store && <KVRow label="Точка" value={payout.seller_store} />}
        <KVRow label="Сумма" value={fmtMoney(payout.amount)} valueStyle={{ fontSize: 15 }} />
        <KVRow label="Способ" value={methodLabel} />
        <KVRow label="Реквизиты" value={payout.details ?? '—'} />
        <KVRow label="Статус" value={statusLabel} />
        <KVRow label="Создана" value={formatDateTime(payout.created_at)} />
        {payout.taken_at && <KVRow label="Взята в работу" value={formatDateTime(payout.taken_at)} />}
        {payout.paid_at && <KVRow label="Выплачена" value={formatDateTime(payout.paid_at)} />}
        {payout.external_txn_id && <KVRow label="Транзакция" value={payout.external_txn_id} />}
        {payout.rejected_at && <KVRow label="Отклонена" value={formatDateTime(payout.rejected_at)} />}
        {payout.status === 'rejected' && payout.admin_comment && <KVRow label="Причина" value={payout.admin_comment} />}
      </div>

      {/* В-8-A: which receipts this money is for — they become «Выплачен» when paid. */}
      <div className="vliq-sec-t"><b>Чеки в заявке</b></div>
      <div className="vliq-card" style={{ padding: '4px 16px', marginBottom: 16 }} aria-label="Чеки в заявке">
        {coveredLoading ? (
          <div style={{ display: 'grid', placeItems: 'center', padding: 12 }}><Spinner size={20} /></div>
        ) : covered && covered.length > 0 ? (
          covered.map((c) => (
            <KVRow
              key={c.receipt_id}
              label={`Чек #${c.receipt_id}${c.purchase_date ? ` · ${formatDate(c.purchase_date)}` : ''}`}
              value={`${fmtMoney(c.amount)}${c.amount < c.bonus_amount ? ` из ${fmtMoney(c.bonus_amount)}` : ''} · ${RECEIPT_STATUS_LABEL[c.receipt_status] ?? c.receipt_status}`}
            />
          ))
        ) : (
          <p style={{ fontSize: 13, color: 'var(--vliq-hint)', margin: '10px 0' }}>
            Сумма не привязана к чекам (начисления без чека).
          </p>
        )}
      </div>

      {isActionable && blocked && (
        <div role="alert" style={{
          display: 'flex', gap: 8, alignItems: 'flex-start', borderRadius: 14, padding: '12px 16px', marginBottom: 12,
          background: 'var(--vliq-dg-bg)', color: 'var(--vliq-dg-ink)', fontSize: 13, fontWeight: 600, lineHeight: 1.4,
        }}>
          <Icon name="block" size={16} className="flex-none" />
          <span>Продавец заблокирован — выплатить нельзя. Отклоните заявку (сумма вернётся на его баланс) или разблокируйте продавца.</span>
        </div>
      )}

      {isActionable ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {payout.status === 'new' && !blocked && (
            <button type="button" disabled={busy} onClick={() => take.mutate(payoutId)}
              style={btn('var(--vliq-field)', 'var(--vliq-brand)', busy)}>
              <Icon name="clock" size={18} /> Взять в работу
            </button>
          )}
          {!blocked && <input
            aria-label="Номер транзакции"
            value={txnId}
            maxLength={128}
            onChange={(e) => setTxnId(e.target.value)}
            placeholder="Номер транзакции в банке (необязательно)"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '12px 14px', borderRadius: 14, border: 'none',
              background: 'var(--vliq-field)', color: 'var(--vliq-text)', fontSize: 14, fontFamily: 'inherit',
            }}
          />}
          <div style={{ display: 'grid', gridTemplateColumns: blocked ? '1fr' : 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
            {!blocked && (
              <button type="button" disabled={busy} onClick={() => approve.mutate({ id: payoutId, externalTxnId: txnId })}
                style={btn('var(--vliq-ok-bg)', 'var(--vliq-ok-ink)', busy)}>
                <Icon name="check" size={18} /> Выплачено
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setRejectOpen(true)}
              style={btn('var(--vliq-dg-bg)', 'var(--vliq-dg-ink)', busy)}>
              <Icon name="x" size={18} /> Отклонить
            </button>
          </div>
        </div>
      ) : (
        <div
          style={{
            padding: '12px 16px', borderRadius: 14, background: 'var(--vliq-field)', color: 'var(--vliq-hint)',
            fontSize: 13, fontWeight: 600, textAlign: 'center',
          }}
        >
          Заявка завершена — действия недоступны
        </div>
      )}

      <RejectReasonSheet
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        copy={REJECT_COPY}
        isSubmitting={reject.isPending}
        onConfirm={(reason) => {
          setRejectOpen(false)
          reject.mutate({ id: payoutId, reason })
        }}
      />
    </div>
  )
}
