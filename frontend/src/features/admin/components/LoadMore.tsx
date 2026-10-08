import { useLoadMoreSentinel } from '@/hooks/useLoadMoreSentinel'

interface LoadMoreProps {
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => unknown
  /** Last page request failed: stop auto-loading, leave the manual button. */
  isError?: boolean
}

/** Infinite-scroll sentinel + explicit «Загрузить ещё» fallback button. */
export function LoadMore({ hasMore, isLoading, onLoadMore, isError = false }: LoadMoreProps) {
  const sentinelRef = useLoadMoreSentinel(hasMore && !isError, isLoading, onLoadMore)
  return (
    <>
      {hasMore && (
        <button
          type="button"
          onClick={() => void onLoadMore()}
          disabled={isLoading}
          style={{
            padding: '12px 16px',
            borderRadius: 14,
            border: 'none',
            background: 'var(--vliq-field)',
            color: 'var(--vliq-text)',
            fontSize: 14,
            fontWeight: 700,
            cursor: isLoading ? 'default' : 'pointer',
            fontFamily: 'inherit',
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          {isLoading ? 'Загрузка…' : isError ? 'Не загрузилось — повторить' : 'Загрузить ещё'}
        </button>
      )}
      <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
    </>
  )
}
