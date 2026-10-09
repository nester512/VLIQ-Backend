import { useSearchParams } from 'react-router-dom'
import { MetricCard } from '@/components/molecules/MetricCard'
import { MetricCardSkeleton, ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { FilterPills } from '@/components/molecules/FilterPills'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useUiStore } from '@/store/uiStore'
import { usePayoutsInfinite, usePayoutSummary } from '@/features/admin/hooks/usePayoutsList'
import { fmtMoney } from '@/utils/formatMoney'
import { formatDateTime } from '@/utils/formatDate'
import { LoadMore } from '@/features/admin/components/LoadMore'
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
  { value: 'rejected',    label: 'Отклонены' },
]

interface PayoutRowProps {
  payout: PayoutRequest
  onClick: () => void
}

function PayoutRow({ payout, onClick }: PayoutRowProps) {
  const kind = STATUS_KIND[payout.status] ?? 'muted'
  const statusLabel = STATUS_LABEL[payout.status] ?? payout.status
  const methodLabel = METHOD_LABEL[payout.method] ?? payout.method
  // The list shows the last digits only; the full number is in the payout sheet.
  const digits = payout.details?.replace(/\D/g, '') ?? ''
  const shortDest = digits.length >= 4 && !payout.details?.includes('*') ? `•••• ${digits.slice(-4)}` : payout.details
  const details = shortDest ? `${methodLabel} ${shortDest}` : methodLabel
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
        <span style={{ fontSize: 11.5 }} data-testid="payout-created">
          {formatDateTime(payout.created_at)}
          {payout.status === 'paid' && payout.paid_at ? ` · выплачена ${formatDateTime(payout.paid_at)}` : ''}
        </span>
      </div>
      <div className="vliq-row-end">
        <b className="vliq-tabnum" style={{ fontSize: 14, fontWeight: 800, color: 'var(--vliq-text)', whiteSpace: 'nowrap' }}>
          {fmtMoney(payout.amount)}
        </b>
        <Pill kind={kind}>{statusLabel}</Pill>
      </div>
    </button>
  )
}

const ORDER_PILLS = [
  { value: 'desc', label: 'Сначала новые' },
  { value: 'asc', label: 'Сначала старые' },
]

function PayoutsContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)

  const statusParam = searchParams.get('status')
  const statusFilter: StatusFilter = statusParam === 'new'
    || statusParam === 'in_progress'
    || statusParam === 'paid'
    || statusParam === 'rejected'
    ? statusParam
    : 'all'

  // Sort survives «назад» and reloads like the status filter (URL, not component state).
  const order: 'desc' | 'asc' = searchParams.get('order') === 'asc' ? 'asc' : 'desc'
  function setOrder(next: 'desc' | 'asc') {
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (next === 'asc') params.set('order', 'asc')
      else params.delete('order')
      return params
    }, { replace: true })
  }

  function setStatusFilter(next: StatusFilter) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (next === 'all') params.delete('status')
      else params.set('status', next)
      return params
    }, { replace: true })
  }

  // «Выплаты продавца» from the seller page: ?seller=<telegram_id> (his whole history,
  // incl. requests held because he is blocked).
  const sellerParam = Number(searchParams.get('seller'))
  const sellerId = Number.isFinite(sellerParam) && sellerParam > 0 ? sellerParam : undefined
  // «Заблокированные»: requests in progress of blocked sellers — out of the main queue.
  const onlyBlocked = searchParams.get('blocked') === 'only'
  function setParam(key: string, value: string | null) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (value === null) params.delete(key)
      else params.set(key, value)
      return params
    }, { replace: true })
  }

  // Totals come from the server over EVERY request (not the sum of a loaded page).
  const { data: summary, isLoading: aggLoading } = usePayoutSummary(sellerId)
  const apiStatus = statusFilter === 'all' ? undefined : statusFilter
  const {
    data: pages, isLoading: listLoading, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError,
  } = usePayoutsInfinite({
    status: apiStatus, order, seller_id: sellerId,
    blocked: onlyBlocked ? 'only' : sellerId != null ? 'include' : 'exclude',
  })
  const blockedHeld = summary?.blocked_in_progress?.count ?? 0

  const items = pages?.pages.flatMap((p) => p.items) ?? []
  const listTotal = pages?.pages[0]?.total
  const pendingTotal = (summary?.new.amount ?? 0) + (summary?.in_progress.amount ?? 0)
  const newCount = summary?.new.count ?? 0
  const inProgressCount = summary?.in_progress.count ?? 0
  const paidTotal = summary?.paid_this_month.amount ?? 0
  const paidCount = summary?.paid_this_month.count ?? 0

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
        {aggLoading && !summary ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              title="К выплате"
              value={fmtMoney(pendingTotal)}
              delta={
                newCount + inProgressCount > 0
                  ? [newCount > 0 && `новых ${newCount}`, inProgressCount > 0 && `в работе ${inProgressCount}`].filter(Boolean).join(' · ')
                  : 'нет заявок к выплате'
              }
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
        {sellerId != null && (
          <button type="button" onClick={() => setParam('seller', null)} aria-label="Сбросить фильтр по продавцу"
            style={{ marginBottom: 10, padding: '7px 12px', borderRadius: 20, border: 0, background: 'var(--vliq-brand)',
              color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Продавец #{sellerId} ×
          </button>
        )}
        {sellerId == null && (blockedHeld > 0 || onlyBlocked) && (
          <button type="button" onClick={() => setParam('blocked', onlyBlocked ? null : 'only')}
            style={{ display: 'block', marginBottom: 10, padding: '7px 12px', borderRadius: 20, border: 0, fontWeight: 700, fontSize: 13,
              cursor: 'pointer', background: onlyBlocked ? 'var(--vliq-dg)' : 'var(--vliq-dg-bg)', color: onlyBlocked ? '#fff' : 'var(--vliq-dg-ink)' }}>
            {onlyBlocked ? 'Заблокированные продавцы ×' : `Заблокированные продавцы: ${blockedHeld} — не в очереди`}
          </button>
        )}
        <FilterPills
          options={FILTER_PILLS}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
        />
        <div style={{ height: 8 }} />
        <FilterPills
          options={ORDER_PILLS}
          value={order}
          onChange={(v) => setOrder(v === 'asc' ? 'asc' : 'desc')}
        />
      </div>

      <div className="vliq-pad">
        <div className="vliq-sec-t">
          <b>Заявки{listTotal != null ? ` · ${listTotal}` : ''}</b>
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
            <LoadMore
              hasMore={Boolean(hasNextPage)}
              isLoading={isFetchingNextPage}
              isError={isFetchNextPageError}
              onLoadMore={fetchNextPage}
            />
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
