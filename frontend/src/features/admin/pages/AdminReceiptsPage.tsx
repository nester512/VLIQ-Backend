import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAdminReceipts, type AdminReceipt } from '@/api/admin'
import { FilterPills } from '@/components/molecules/FilterPills'
import { Pill } from '@/components/atoms/Pill'
import { Icon } from '@/components/atoms/Icon'
import { ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { EmptyState } from '@/components/molecules/EmptyState'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { RECEIPT_STATUS, type StatusKind } from '@/utils/receiptStatus'
import { fmtMoney } from '@/utils/formatMoney'
import { formatDateTime } from '@/utils/formatDate'
import { useUiStore } from '@/store/uiStore'

type ReceiptFilter = 'all' | 'on_review' | 'approved' | 'needs_revision' | 'rejected' | 'paid_out'

const FILTER_PILLS: Array<{ value: ReceiptFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'on_review', label: 'На проверке' },
  { value: 'approved', label: 'Одобрены' },
  { value: 'needs_revision', label: 'Доработать' },
  { value: 'rejected', label: 'Отклонены' },
  { value: 'paid_out', label: 'Выплачены' },
]

const ICON_BG: Record<StatusKind, { bg: string; ink: string }> = {
  ok: { bg: 'var(--vliq-ok-bg)', ink: 'var(--vliq-ok-ink)' },
  dg: { bg: 'var(--vliq-dg-bg)', ink: 'var(--vliq-dg-ink)' },
  wn: { bg: 'var(--vliq-wn-bg)', ink: 'var(--vliq-wn-ink)' },
  muted: { bg: 'var(--vliq-field)', ink: 'var(--vliq-hint)' },
}

function ReceiptRow({ receipt, onClick }: { receipt: AdminReceipt; onClick: () => void }) {
  const status = RECEIPT_STATUS[receipt.status]
  const kind = status?.kind ?? 'muted'
  const seller = receipt.seller_name ?? `Продавец #${receipt.seller_id}`
  const shop = receipt.shop_name ?? 'Магазин не распознан'

  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <div className="vliq-row-ic" style={{ background: ICON_BG[kind].bg, color: ICON_BG[kind].ink }}>
        <Icon name="receipt" size={21} />
      </div>
      <div className="vliq-row-tx">
        <b>{shop}</b>
        <span>{seller} · {formatDateTime(receipt.created_at)}</span>
      </div>
      <div style={{ flex: 'none', textAlign: 'right', maxWidth: 120 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--vliq-text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(receipt.amount)}
        </div>
        <Pill kind={kind} className="mt-[4px]">{status?.label ?? receipt.status}</Pill>
      </div>
    </button>
  )
}

function AdminReceiptsContent() {
  const [searchParams, setSearchParams] = useSearchParams()
  const openSheet = useUiStore((s) => s.openSheet)
  const param = searchParams.get('status')
  const selected: ReceiptFilter = FILTER_PILLS.some((p) => p.value === param)
    ? param as ReceiptFilter
    : 'all'

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'receipts', selected],
    queryFn: () => getAdminReceipts({ status: selected === 'all' ? undefined : [selected], limit: 100 }),
    staleTime: 30_000,
  })
  const receipts = data?.items ?? []

  function setFilter(next: ReceiptFilter) {
    setSearchParams((current) => {
      const params = new URLSearchParams(current)
      if (next === 'all') params.delete('status')
      else params.set('status', next)
      return params
    }, { replace: true })
  }

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FilterPills options={FILTER_PILLS} value={selected} onChange={(value) => setFilter(value as ReceiptFilter)} />
      {!isLoading && data && (
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--vliq-hint)' }}>
          {data.total} {data.total === 1 ? 'чек' : 'чеков'}
        </div>
      )}
      {isLoading ? (
        <div className="vliq-list"><ReceiptRowSkeleton /><ReceiptRowSkeleton /><ReceiptRowSkeleton /><ReceiptRowSkeleton /></div>
      ) : receipts.length === 0 ? (
        <EmptyState
          icon="receipt"
          tone="brand"
          title={selected === 'all' ? 'Чеков пока нет' : 'Под фильтр ничего не подходит'}
          description={selected === 'all' ? 'Загруженные продавцами чеки появятся здесь.' : 'Измените фильтр или дождитесь новых чеков.'}
        />
      ) : (
        <div className="vliq-list">
          {receipts.map((receipt) => (
            <ReceiptRow key={receipt.id} receipt={receipt} onClick={() => openSheet('detail', { receiptId: receipt.id, receipt })} />
          ))}
        </div>
      )}
    </div>
  )
}

export function AdminReceiptsPage() {
  return <ErrorBoundary><AdminReceiptsContent /></ErrorBoundary>
}
