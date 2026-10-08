import { useState } from 'react'
import { useParams } from 'react-router-dom'
import type { AdminReceipt, AdminSellerDetail } from '@/api/admin'
import { Avatar } from '@/components/atoms/Avatar'
import { Pill } from '@/components/atoms/Pill'
import { Icon } from '@/components/atoms/Icon'
import { Spinner } from '@/components/atoms/Spinner'
import { ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { EmptyState } from '@/components/molecules/EmptyState'
import { FilterPills } from '@/components/molecules/FilterPills'
import { KVRow } from '@/components/molecules/KVRow'
import { BlockSellerSheet } from '@/components/molecules/BlockSellerSheet'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { LoadMore } from '@/features/admin/components/LoadMore'
import { RiskPill, SellerStatsPanel } from '@/features/admin/components/SellerStats'
import {
  useSellerDetail,
  useSellerReceiptsInfinite,
  useSellerStatusToggle,
} from '@/features/admin/hooks/useSellersList'
import { RECEIPT_STATUS, type StatusKind } from '@/utils/receiptStatus'
import { fmtInt, fmtMoney } from '@/utils/formatMoney'
import { formatDate, formatDateTime } from '@/utils/formatDate'
import { getFullName, getInitials } from '@/utils/initials'
import { useUiStore } from '@/store/uiStore'

const ICON_BG: Record<StatusKind, { bg: string; ink: string }> = {
  ok:    { bg: 'var(--vliq-ok-bg)',    ink: 'var(--vliq-ok-ink)' },
  dg:    { bg: 'var(--vliq-dg-bg)',    ink: 'var(--vliq-dg-ink)' },
  wn:    { bg: 'var(--vliq-wn-bg)',    ink: 'var(--vliq-wn-ink)' },
  muted: { bg: 'var(--vliq-field)',    ink: 'var(--vliq-hint)' },
}

/** History filter — every status, not only the review queue. */
const HISTORY_FILTERS = [
  { value: '',              label: 'Все' },
  { value: 'on_review',     label: 'На проверке' },
  { value: 'approved',      label: 'Одобрены' },
  { value: 'paid_out',      label: 'Выплачены' },
  { value: 'rejected',      label: 'Отклонены' },
  { value: 'needs_revision', label: 'На доработке' },
]

function ReceiptRow({ receipt, onClick }: { receipt: AdminReceipt; onClick: () => void }) {
  const status = RECEIPT_STATUS[receipt.status]
  const kind = status?.kind ?? 'muted'
  const ic = ICON_BG[kind]
  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <div className="vliq-row-ic" style={{ background: ic.bg, color: ic.ink }}>
        <Icon name="receipt" size={21} />
      </div>
      <div className="vliq-row-tx">
        <b>{receipt.shop_name ?? `Чек #${receipt.id}`}</b>
        <span>{formatDateTime(receipt.created_at)}</span>
      </div>
      <div style={{ flex: 'none', textAlign: 'right', maxWidth: 130 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--vliq-text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(receipt.amount)}
        </div>
        <Pill kind={kind} className="mt-[4px]">{status?.label ?? receipt.status}</Pill>
      </div>
    </button>
  )
}

function SellerHeader({ seller }: { seller: AdminSellerDetail }) {
  const { mutate: toggle, isPending } = useSellerStatusToggle()
  const [blockOpen, setBlockOpen] = useState(false)
  const isBlocked = seller.status === 'blocked'
  const isPendingSeller = seller.status === 'pending'
  const fullName = getFullName(seller, seller.telegram_id ?? seller.id)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <Avatar initials={getInitials(seller)} size={52} className="rounded-[15px]" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--vliq-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fullName}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            <Pill kind={isBlocked ? 'dg' : isPendingSeller ? 'wn' : 'ok'}>
              {isBlocked ? 'Блок' : isPendingSeller ? 'Ожидает' : 'Активен'}
            </Pill>
            <RiskPill stats={seller.stats} />
          </div>
        </div>
      </div>

      <div className="vliq-card" style={{ padding: '0 16px' }}>
        <KVRow label="Telegram ID" value={String(seller.telegram_id ?? seller.id)} />
        <KVRow label="Телефон" value={seller.phone ?? '—'} />
        <KVRow label="Город" value={seller.city ?? '—'} />
        <KVRow label="Торговая точка" value={seller.store_name ?? '—'} />
        <KVRow label="Регистрация" value={seller.registered_at ? formatDate(seller.registered_at) : '—'} />
        {isBlocked && seller.block_reason && <KVRow label="Причина блокировки" value={seller.block_reason} />}
      </div>

      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (isBlocked) toggle({ telegram_id: seller.telegram_id ?? seller.id, block: false })
          else setBlockOpen(true)
        }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: 12, borderRadius: 14, fontSize: 13, fontWeight: 700, border: 0,
          background: isBlocked ? 'var(--vliq-ok-bg)' : 'var(--vliq-dg-bg)',
          color: isBlocked ? 'var(--vliq-ok-ink)' : 'var(--vliq-dg-ink)',
          cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.6 : 1,
          fontFamily: 'inherit',
        }}
      >
        <Icon name={isBlocked ? 'check' : 'block'} size={18} />
        {isBlocked ? 'Разблокировать' : 'Заблокировать'}
      </button>

      <BlockSellerSheet
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        sellerName={fullName}
        isSubmitting={isPending}
        onConfirm={(reason) =>
          toggle(
            { telegram_id: seller.telegram_id ?? seller.id, block: true, reason: reason ?? undefined },
            { onSettled: () => setBlockOpen(false) },
          )
        }
      />
    </>
  )
}

function SellerPageContent() {
  const { telegramId } = useParams<{ telegramId: string }>()
  const parsedId = telegramId ? parseInt(telegramId, 10) : undefined
  const sellerId = parsedId != null && Number.isFinite(parsedId) ? parsedId : undefined
  const openSheet = useUiStore((s) => s.openSheet)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: seller, isLoading: sellerLoading, isError: sellerError } = useSellerDetail(sellerId)
  const { data, isLoading, isFetchNextPageError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSellerReceiptsInfinite(sellerId, statusFilter || undefined)

  const receipts = data?.pages.flatMap((p) => p.items) ?? []
  const total = data?.pages[0]?.total ?? 0

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {sellerLoading ? (
        <div style={{ padding: '32px 0', display: 'grid', placeItems: 'center' }}>
          <Spinner size={28} className="text-[var(--vliq-brand)]" />
        </div>
      ) : sellerError || !seller ? (
        <EmptyState icon="users" tone="muted" title="Продавец не найден" description={`Telegram ID ${telegramId ?? '—'}`} />
      ) : (
        <>
          <SellerHeader seller={seller} />
          <SellerStatsPanel seller={seller} />
        </>
      )}

      <div className="vliq-sec-t" style={{ marginTop: 6 }}>
        <b>История чеков</b>
      </div>
      <FilterPills options={HISTORY_FILTERS} value={statusFilter} onChange={setStatusFilter} />

      {isLoading ? (
        <div className="vliq-list">
          <ReceiptRowSkeleton /><ReceiptRowSkeleton /><ReceiptRowSkeleton />
        </div>
      ) : receipts.length === 0 ? (
        <EmptyState
          icon="receipt"
          tone="brand"
          title={statusFilter ? 'Нет чеков с таким статусом' : 'Чеков пока нет'}
          description={statusFilter ? 'Выберите другой фильтр.' : 'Продавец ещё не загружал чеки.'}
        />
      ) : (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--vliq-hint)' }} data-testid="seller-receipts-total">
            Всего: {fmtInt(total)}{receipts.length < total ? ` · показано ${fmtInt(receipts.length)}` : ''}
          </div>
          <div className="vliq-list">
            {receipts.map((receipt) => (
              <ReceiptRow
                key={receipt.id}
                receipt={receipt}
                onClick={() => openSheet('detail', { receiptId: receipt.id, receipt })}
              />
            ))}
          </div>
          <LoadMore
            hasMore={Boolean(hasNextPage)}
            isLoading={isFetchingNextPage}
            isError={isFetchNextPageError}
            onLoadMore={fetchNextPage}
          />
        </>
      )}
    </div>
  )
}

/** Admin seller page: profile, stats, risk, block/unblock and the full receipt history. */
export function SellerReceiptsPage() {
  return (
    <ErrorBoundary>
      <SellerPageContent />
    </ErrorBoundary>
  )
}
