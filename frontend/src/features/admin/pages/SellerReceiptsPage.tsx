import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAdminReceipts, getAdminSellerById, type AdminReceipt } from '@/api/admin'
import { Pill } from '@/components/atoms/Pill'
import { Icon } from '@/components/atoms/Icon'
import { ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { EmptyState } from '@/components/molecules/EmptyState'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { RECEIPT_STATUS, type StatusKind } from '@/utils/receiptStatus'
import { fmtMoney } from '@/utils/formatMoney'
import { formatDateTime } from '@/utils/formatDate'
import { useUiStore } from '@/store/uiStore'

const ICON_BG: Record<StatusKind, { bg: string; ink: string }> = {
  ok:    { bg: 'var(--vliq-ok-bg)',    ink: 'var(--vliq-ok-ink)' },
  dg:    { bg: 'var(--vliq-dg-bg)',    ink: 'var(--vliq-dg-ink)' },
  wn:    { bg: 'var(--vliq-wn-bg)',    ink: 'var(--vliq-wn-ink)' },
  muted: { bg: 'var(--vliq-field)',    ink: 'var(--vliq-hint)' },
}

const PAGE_LIMIT = 50

interface ReceiptRowProps {
  receipt: AdminReceipt
  onClick: () => void
}

function ReceiptRow({ receipt, onClick }: ReceiptRowProps) {
  const status = RECEIPT_STATUS[receipt.status]
  const kind = status?.kind ?? 'muted'
  const label = status?.label ?? receipt.status
  const ic = ICON_BG[kind]

  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <div className="vliq-row-ic" style={{ background: ic.bg, color: ic.ink }}>
        <Icon name="receipt" size={21} />
      </div>
      <div className="vliq-row-tx">
        <b>{receipt.shop_name ?? '—'}</b>
        <span>{formatDateTime(receipt.created_at)}</span>
      </div>
      <div style={{ flex: 'none', textAlign: 'right', maxWidth: 120 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: 'var(--vliq-text)',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmtMoney(receipt.amount)}
        </div>
        <Pill kind={kind} className="mt-[4px]">
          {label}
        </Pill>
      </div>
    </button>
  )
}

function SellerReceiptsContent() {
  const { telegramId } = useParams<{ telegramId: string }>()
  const parsedId = telegramId ? parseInt(telegramId, 10) : undefined
  const openSheet = useUiStore((s) => s.openSheet)

  const { data: seller } = useQuery({
    queryKey: ['admin', 'seller-detail', parsedId],
    queryFn: () => {
      if (!parsedId) throw new Error('telegramId required')
      return getAdminSellerById(parsedId)
    },
    enabled: parsedId != null,
    staleTime: 30_000,
    retry: false,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'seller-receipts', parsedId],
    queryFn: () => {
      if (!parsedId) throw new Error('telegramId required')
      return getAdminReceipts({ seller_id: parsedId, page: 1, limit: PAGE_LIMIT })
    },
    enabled: parsedId != null,
    staleTime: 30_000,
  })

  const items = data?.items ?? []
  const isEmpty = !isLoading && items.length === 0

  const sellerName =
    seller
      ? [seller.first_name, seller.last_name].filter(Boolean).join(' ') || `#${parsedId}`
      : `#${parsedId}`

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Subtitle showing whose receipts these are */}
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--vliq-hint)' }}>
        {sellerName}
        {data?.total != null ? ` · ${data.total} чеков` : ''}
      </div>

      {isLoading ? (
        <div className="vliq-list">
          <ReceiptRowSkeleton />
          <ReceiptRowSkeleton />
          <ReceiptRowSkeleton />
          <ReceiptRowSkeleton />
          <ReceiptRowSkeleton />
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon="receipt"
          tone="brand"
          title="У продавца пока нет чеков"
          description="Когда продавец загрузит первый чек — он появится здесь."
        />
      ) : (
        <div className="vliq-list">
          {items.map((receipt) => (
            <ReceiptRow
              key={receipt.id}
              receipt={receipt}
              onClick={() => openSheet('detail', { receiptId: receipt.id, receipt })}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SellerReceiptsPage() {
  return (
    <ErrorBoundary>
      <SellerReceiptsContent />
    </ErrorBoundary>
  )
}
