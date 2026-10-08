import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  blockSeller,
  getAdminReceipts,
  getAdminSellerById,
  getAdminSellers,
  unblockSeller,
  type AdminSellersFilters,
} from '@/api/admin'
import { useUiStore } from '@/store/uiStore'
import { extractApiError } from '@/api/client'

/** Page size of the admin seller list (infinite scroll). */
export const SELLERS_PAGE_SIZE = 50
/** Page size of a seller's receipt history (infinite scroll). */
export const SELLER_RECEIPTS_PAGE_SIZE = 30

export function useSellersList(filters: AdminSellersFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'sellers', filters],
    queryFn: () => getAdminSellers(filters),
    staleTime: 30_000,
  })
}

/**
 * Server-side filtered + sorted seller list that pages through EVERY seller
 * (the old list showed only the first 50 with no way to reach the rest).
 */
export function useSellersInfinite(filters: Omit<AdminSellersFilters, 'page' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['admin', 'sellers', 'infinite', filters],
    queryFn: ({ pageParam }) =>
      getAdminSellers({ ...filters, page: pageParam as number, limit: SELLERS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    staleTime: 30_000,
  })
}

/** All receipts of one seller, newest first, optionally filtered by status. */
export function useSellerReceiptsInfinite(telegram_id: number | undefined, status?: string) {
  return useInfiniteQuery({
    queryKey: ['admin', 'seller-receipts', telegram_id, status ?? null],
    queryFn: ({ pageParam }) =>
      getAdminReceipts({
        seller_id: telegram_id,
        status: status ? [status] : undefined,
        order: 'desc',
        page: pageParam as number,
        limit: SELLER_RECEIPTS_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    enabled: telegram_id != null,
    staleTime: 15_000,
  })
}

/**
 * Block / unblock through the dedicated POST endpoints — they also notify the
 * seller in Telegram and write the audit log (a plain PATCH of `status` did neither).
 */
export function useSellerStatusToggle() {
  const qc = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  return useMutation({
    mutationFn: ({ telegram_id, block, reason }: { telegram_id: number; block: boolean; reason?: string }) =>
      block ? blockSeller(String(telegram_id), reason ?? null) : unblockSeller(String(telegram_id)),
    onSuccess: (_data, { block }) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'sellers'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'seller-detail'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
      pushToast(block ? 'Продавец заблокирован' : 'Продавец разблокирован', block ? 'dg' : 'ok')
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })
}

export function useSellerDetail(telegram_id: number | undefined) {
  return useQuery({
    queryKey: ['admin', 'seller-detail', telegram_id],
    queryFn: () => {
      if (!telegram_id) throw new Error('telegram_id required')
      return getAdminSellerById(telegram_id)
    },
    enabled: telegram_id != null,
    staleTime: 30_000,
    retry: false,
  })
}
