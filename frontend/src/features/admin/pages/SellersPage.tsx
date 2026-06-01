import { useState } from 'react'
import { SearchBar } from '@/components/molecules/SearchBar'
import { FilterPills } from '@/components/molecules/FilterPills'
import { Avatar } from '@/components/atoms/Avatar'
import { Pill } from '@/components/atoms/Pill'
import { RowSkeleton } from '@/components/atoms/Skeleton'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useUiStore } from '@/store/uiStore'
import { useSellersList } from '@/features/admin/hooks/useSellersList'
import { getInitials, getFullName } from '@/utils/initials'
import type { AdminSellerRow } from '@/api/admin'

type StatusFilter = 'all' | 'active' | 'blocked'

const STATUS_PILLS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all',     label: 'Все' },
  { value: 'active',  label: 'Активные' },
  { value: 'blocked', label: 'Заблокированные' },
]

interface SellerRowProps {
  seller: AdminSellerRow
  onClick: () => void
}

function SellerRow({ seller, onClick }: SellerRowProps) {
  const fullName = getFullName(seller, seller.telegram_id ?? seller.id)
  const initials = getInitials(seller)
  const subtitle = [seller.store_name, seller.city].filter(Boolean).join(' · ') || '—'

  // Three-way status — pending != blocked.
  let pillKind: 'ok' | 'wn' | 'dg' = 'ok'
  let pillLabel = 'Активен'
  if (seller.status === 'pending') {
    pillKind = 'wn'
    pillLabel = 'Ожидает'
  } else if (seller.status === 'blocked') {
    pillKind = 'dg'
    pillLabel = 'Блок'
  }

  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <Avatar initials={initials} size={40} className="rounded-[13px] flex-none" />
      <div className="vliq-row-tx">
        <b>{fullName}</b>
        <span>{subtitle}</span>
      </div>
      {/* Trailing column gets explicit right offset so the pill never sits
          flush against the rounded card corner. */}
      <div style={{ flex: 'none', textAlign: 'right', marginRight: 4 }}>
        <Pill kind={pillKind}>{pillLabel}</Pill>
      </div>
    </button>
  )
}

function SellersContent() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const openSheet = useUiStore((s) => s.openSheet)

  const apiStatus =
    statusFilter === 'all' ? undefined : statusFilter === 'active' ? 'active' : 'blocked'

  const { data, isLoading } = useSellersList({
    search: search.trim() || undefined,
    status: apiStatus,
    limit: 50,
  })

  const sellers = data?.items ?? []
  const isEmpty = !isLoading && sellers.length === 0
  const isFiltered = Boolean(search.trim() || statusFilter !== 'all')

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SearchBar
        placeholder="Поиск продавца"
        value={search}
        onChange={setSearch}
      />

      <FilterPills
        options={STATUS_PILLS}
        value={statusFilter}
        onChange={(v) => setStatusFilter(v as StatusFilter)}
      />

      {isLoading ? (
        <div className="vliq-list">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : isEmpty ? (
        <EmptyState
          icon="users"
          tone="brand"
          title={isFiltered ? 'Ничего не нашли' : 'Продавцов пока нет'}
          description={
            isFiltered
              ? 'Попробуйте другой запрос или сбросьте фильтр.'
              : 'Когда первые продавцы зарегистрируются — они появятся здесь.'
          }
        />
      ) : (
        <div className="vliq-list">
          {sellers.map((seller) => (
            <SellerRow
              key={seller.id}
              seller={seller}
              onClick={() => {
                if (seller.telegram_id) {
                  openSheet('seller', { telegram_id: seller.telegram_id })
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function SellersPage() {
  return (
    <ErrorBoundary>
      <SellersContent />
    </ErrorBoundary>
  )
}
