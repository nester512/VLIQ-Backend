import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchBar } from '@/components/molecules/SearchBar'
import { FilterPills } from '@/components/molecules/FilterPills'
import { ReceiptRow } from '@/components/molecules/ReceiptRow'
import { ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useReceipts } from '../hooks/useReceipts'

const FILTER_OPTIONS = [
  { value: '',          label: 'Все' },
  { value: 'approved',  label: 'Одобрены' },
  { value: 'on_review', label: 'На проверке' },
  { value: 'rejected',  label: 'Отклонены' },
]

function HistoryContent() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: receipts, isLoading } = useReceipts({
    status: statusFilter || undefined,
  })

  const filtered = receipts?.filter((r) =>
    search.trim() ? r.id.toLowerCase().includes(search.toLowerCase()) : true,
  )

  const isFiltered = Boolean(search.trim() || statusFilter)

  return (
    <div className="vliq-history-wrap">
      {/* Main list column */}
      <div
        className="vliq-pad vliq-history-col"
        style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <SearchBar
          placeholder="Поиск по номеру"
          value={search}
          onChange={setSearch}
        />
        <FilterPills
          options={FILTER_OPTIONS}
          value={statusFilter}
          onChange={setStatusFilter}
        />

        {isLoading ? (
          <div className="vliq-list">
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
          </div>
        ) : filtered && filtered.length > 0 ? (
          <div className="vliq-list">
            {filtered.map((r) => (
              <ReceiptRow
                key={r.id}
                receipt={r}
                onClick={() => navigate(`/seller/status/${r.id}`)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon="receipt"
            tone="brand"
            title={isFiltered ? 'Ничего не нашли' : 'Чеков пока нет'}
            description={
              isFiltered
                ? 'Попробуйте другой запрос или фильтр.'
                : 'Загрузите первый чек — он появится здесь.'
            }
          />
        )}
      </div>
      {/* Desktop aside: filter/stats panel rendered via CSS grid, empty slot at tablet */}
    </div>
  )
}

export function HistoryPage() {
  return (
    <ErrorBoundary>
      <HistoryContent />
    </ErrorBoundary>
  )
}
