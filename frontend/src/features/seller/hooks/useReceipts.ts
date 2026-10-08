import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getMyReceipts, getMyReceiptsPage, getReceipt } from '@/api/receipts'
import type { ReceiptsFilters } from '@/api/receipts'

/** Page size for the seller receipt history (infinite scroll / load-more). */
export const RECEIPTS_PAGE_SIZE = 50

export function useReceipts(filters: ReceiptsFilters = {}) {
  return useQuery({
    queryKey: ['receipts', 'me', filters],
    queryFn: () => getMyReceipts(filters),
    staleTime: 15_000,
  })
}

/** Single-receipt detail — used by the seller status page. */
export function useReceiptDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['receipts', id],
    queryFn: () => {
      if (!id) throw new Error('Receipt ID is required')
      return getReceipt(id)
    },
    enabled: Boolean(id),
    staleTime: 5_000,
    retry: false,
  })
}
/**
 * Paginated seller receipt history — loads EVERY receipt across pages so a
 * seller with 50+ receipts never 'loses' older ones behind a single-page cap.
 */
export function useReceiptsInfinite(filters: Omit<ReceiptsFilters, 'page'> = {}) {
  const limit = filters.limit ?? RECEIPTS_PAGE_SIZE
  return useInfiniteQuery({
    queryKey: ['receipts', 'me', 'infinite', filters.status ?? null, limit],
    queryFn: ({ pageParam }) =>
      getMyReceiptsPage({ status: filters.status, limit, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    staleTime: 15_000,
  })
}
