import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchBar } from '@/components/molecules/SearchBar'
import { FilterPills } from '@/components/molecules/FilterPills'
import { ReceiptRow } from '@/components/molecules/ReceiptRow'
import { ReceiptRowSkeleton } from '@/components/atoms/Skeleton'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useReceiptsInfinite } from '../hooks/useReceipts'

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

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useReceiptsInfinite({ status: statusFilter || undefined })

  // Flatten EVERY loaded page — the seller sees all their receipts, not just the
  // first page. `total` is the server's true count so we can show it explicitly.
  const receipts = data?.pages.flatMap((p) => p.items) ?? []
  const total = data?.pages[0]?.total ?? 0

  const filtered = receipts.filter((r) =>
    search.trim() ? r.id.toLowerCase().includes(search.toLowerCase()) : true,
  )
  const isFiltered = Boolean(search.trim() || statusFilter)
  const canLoadMore = hasNextPage && !search.trim()

  // Auto-load the next page when the sentinel scrolls into view. The explicit
  // "Загрузить ещё" button below is the fallback (and the a11y/keyboard path).
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) {
        void fetchNextPage()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [canLoadMore, isFetchingNextPage, fetchNextPage])

  return (
    <div className="vliq-history-wrap">
      <div
        className="vliq-pad vliq-history-col"
        style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <SearchBar placeholder="Поиск по номеру" value={search} onChange={setSearch} />
        <FilterPills options={FILTER_OPTIONS} value={statusFilter} onChange={setStatusFilter} />

        {isLoading ? (
          <div className="vliq-list">
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
            <ReceiptRowSkeleton />
          </div>
        ) : filtered.length > 0 ? (
          <>
            {total > 0 && (
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--vliq-hint)' }}>
                Всего: {total} · показано {receipts.length}
              </div>
            )}
            <div className="vliq-list">
              {filtered.map((r) => (
                <ReceiptRow
                  key={r.id}
                  receipt={r}
                  onClick={() => navigate(`/seller/status/${r.id}`)}
                />
              ))}
            </div>
            {canLoadMore && (
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                style={{
                  padding: '12px 16px',
                  borderRadius: 14,
                  border: 'none',
                  background: 'var(--vliq-field)',
                  color: 'var(--vliq-text)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: isFetchingNextPage ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: isFetchingNextPage ? 0.6 : 1,
                }}
              >
                {isFetchingNextPage ? 'Загрузка…' : 'Загрузить ещё'}
              </button>
            )}
            <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
          </>
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
