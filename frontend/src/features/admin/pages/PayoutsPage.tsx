import { useState } from 'react'
import { MetricCard } from '@/components/molecules/MetricCard'
import { MetricCardSkeleton, ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { FilterPills } from '@/components/molecules/FilterPills'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useUiStore } from '@/store/uiStore'
import { usePayoutsList } from '@/features/admin/hooks/usePayoutsList'
import { fmtMoney } from '@/utils/formatMoney'
import type { PayoutRequest } from '@/types/models'

/** Returns the Russian prepositional (locative) month name for "Выплачено в …" */
function getMonthGenitive(date: Date): string {
  const months = [
    'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
    'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре',
  ]
  return months[date.getMonth()] ?? ''
}

type PillKind = 'ok' | 'dg' | 'wn' | 'muted'
type StatusFilter = 'all' | 'new' | 'in_progress' | 'paid' | 'rejected'

const STATUS_LABEL: Record<string, string> = {
  new: 'Новая',
  in_progress: 'В обработке',
  paid: 'Выплачена',
  rejected: 'Отклонена',
}

const STATUS_KIND: Record<string, PillKind> = {
  new: 'wn',
  in_progress: 'muted',
  paid: 'ok',
  rejected: 'dg',
}

const METHOD_LABEL: Record<string, string> = {
  sbp_phone: 'СБП · телефон',
  sbp_bank:  'СБП · банк',
  card:      'Карта',
}

const ICON_BG: Record<PillKind, { bg: string; ink: string }> = {
  ok:    { bg: 'var(--vliq-ok-bg)', ink: 'var(--vliq-ok-ink)' },
  dg:    { bg: 'var(--vliq-dg-bg)', ink: 'var(--vliq-dg-ink)' },
  wn:    { bg: 'var(--vliq-wn-bg)', ink: 'var(--vliq-wn-ink)' },
  muted: { bg: 'var(--vliq-field)', ink: 'var(--vliq-hint)' },
}

const FILTER_PILLS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all',         label: 'Все' },
  { value: 'new',         label: 'Новые' },
  { value: 'in_progress', label: 'В обработке' },
  { value: 'paid',        label: 'Выплачены' },
]

interface PayoutRowProps {
  payout: PayoutRequest
  onClick: () => void
}

function PayoutRow({ payout, onClick }: PayoutRowProps) {
  const kind = STATUS_KIND[payout.status] ?? 'muted'
  const statusLabel = STATUS_LABEL[payout.status] ?? payout.status
  const methodLabel = METHOD_LABEL[payout.method] ?? payout.method
  const details = payout.details ? `${methodLabel} ${payout.details}` : methodLabel
  const ic = ICON_BG[kind]
  const sellerLabel = payout.seller_name?.trim() || `Продавец #${payout.seller_id}`
  const sellerMeta = payout.seller_store ? `${payout.seller_store} · ${details}` : details

  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <div className="vliq-row-ic" style={{ background: ic.bg, color: ic.ink }}>
        <Icon name="cashout" size={21} />
      </div>
      <div className="vliq-row-tx">
        <b>{sellerLabel}</b>
        <span>{sellerMeta}</span>
      </div>
      <div style={{ flex: 'none', textAlign: 'right', maxWidth: 120 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--vliq-text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(payout.amount)}
        </div>
        <Pill kind={kind} className="mt-[4px]">{statusLabel}</Pill>
      </div>
    </button>
  )
}

function PayoutsContent() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)

  // Aggregate metrics computed from the full list (independent of the visible
  // status filter); the visible list comes from a second filtered query.
  const { data: allPage, isLoading: aggLoading } = usePayoutsList({ limit: 200 })
  const apiStatus = statusFilter === 'all' ? undefined : statusFilter
  const { data: visible, isLoading: listLoading } = usePayoutsList({ status: apiStatus, limit: 100 })

  const allItems = allPage?.items ?? []
  const items = visible?.items ?? []

  const pendingTotal = allItems
    .filter((p) => p.status === 'new' || p.status === 'in_progress')
    .reduce((acc, p) => acc + p.amount, 0)
  const paidTotal = allItems
    .filter((p) => p.status === 'paid')
    .reduce((acc, p) => acc + p.amount, 0)
  const paidCount = allItems.filter((p) => p.status === 'paid').length
  const newCount  = allItems.filter((p) => p.status === 'new').length

  return (
    <div>
      {/* Aggregate metrics — same data regardless of filter */}
      <div
        className="vliq-pad"
        style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
          paddingTop: 14, paddingBottom: 4,
        }}
      >
        {aggLoading && allItems.length === 0 ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              title="К выплате"
              value={fmtMoney(pendingTotal)}
              delta={newCount > 0 ? `${newCount} новых заявок` : 'нет новых заявок'}
              deltaColor={newCount > 0 ? 'wn' : 'hint'}
              tween
            />
            <MetricCard
              title={`Выплачено в ${getMonthGenitive(new Date())}`}
              value={fmtMoney(paidTotal)}
              delta={paidCount > 0 ? `${paidCount} выплат` : 'пока ничего'}
              deltaColor={paidCount > 0 ? 'ok' : 'hint'}
              tween
            />
          </>
        )}
      </div>

      {/* Filter pills */}
      <div className="vliq-pad" style={{ marginTop: 14, marginBottom: 14 }}>
        <FilterPills
          options={FILTER_PILLS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
        />
      </div>

      <div className="vliq-pad">
        <div className="vliq-sec-t">
          <b>Заявки</b>
          <button type="button" onClick={() => pushToast('Excel-выгрузка — скоро', 'info')}>
            Excel-выгрузка
          </button>
        </div>

        {listLoading && items.length === 0 ? (
          <div className="vliq-list">
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
          </div>
        ) : items.length > 0 ? (
          <div className="vliq-list">
            {items.map((p) => (
              <PayoutRow
                key={p.id}
                payout={p}
                onClick={() => openSheet('payout', { payoutId: p.id, payout: p })}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="cashout"
            tone="brand"
            title={statusFilter === 'all' ? 'Заявок пока нет' : 'Под фильтр ничего не подходит'}
            description={
              statusFilter === 'all'
                ? 'Когда продавцы попросят выплату — заявки появятся здесь.'
                : 'Поменяйте фильтр или дождитесь новых заявок.'
            }
          />
        )}
      </div>
    </div>
  )
}

export function PayoutsPage() {
  return (
    <ErrorBoundary>
      <PayoutsContent />
    </ErrorBoundary>
  )
}
