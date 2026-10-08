import { useEffect, useRef } from 'react'

/**
 * Infinite scroll: returns a ref for a sentinel element placed after the list;
 * when it scrolls into view and more pages exist, `loadMore` is called.
 * Callers keep an explicit «Загрузить ещё» button as the a11y/keyboard fallback.
 */
export function useLoadMoreSentinel(canLoadMore: boolean, isLoadingMore: boolean, loadMore: () => unknown) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !canLoadMore || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isLoadingMore) void loadMore()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [canLoadMore, isLoadingMore, loadMore])
  return ref
}
