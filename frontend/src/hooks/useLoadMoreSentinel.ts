import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * Infinite scroll: returns a ref for a sentinel element placed after the list;
 * when it scrolls into view and more pages exist, `loadMore` is called.
 *
 * The observer is created once per `enabled` change (loading state and the
 * callback are read through refs) — re-creating it whenever loading flips made
 * a fresh observer fire immediately, so a failing page request was retried in a
 * tight loop while the sentinel stayed visible. Callers pass `enabled=false`
 * after an error and keep the explicit «Загрузить ещё» button as the fallback.
 */
export function useLoadMoreSentinel(enabled: boolean, isLoadingMore: boolean, loadMore: () => unknown) {
  const ref = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(isLoadingMore)
  const loadMoreRef = useRef(loadMore)
  useLayoutEffect(() => {
    loadingRef.current = isLoadingMore
    loadMoreRef.current = loadMore
  })

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !loadingRef.current) void loadMoreRef.current()
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [enabled])
  return ref
}
