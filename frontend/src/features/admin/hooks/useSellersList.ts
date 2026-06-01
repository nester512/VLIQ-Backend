import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAdminSellers, getAdminSellerById, setSellerStatus, type AdminSellersFilters } from '@/api/admin'
import { useUiStore } from '@/store/uiStore'
import { extractApiError } from '@/api/client'

export function useSellersList(filters: AdminSellersFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'sellers', filters],
    queryFn: () => getAdminSellers(filters),
    staleTime: 30_000,
  })
}

/**
 * Single-seller fetch. Backend `GET /sellers/{telegram_id}` is currently a
 * 501 stub, so we derive the row from the paged list query. Once the backend
 * implements the endpoint we can swap to a real GET without changing callers.
 */
/**
 * Toggle a seller between active and blocked. Backend's PATCH /sellers/{id}
 * accepts a `status` field; admin-role required.
 */
export function useSellerStatusToggle() {
  const qc = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const closeSheet = useUiStore((s) => s.closeSheet)
  return useMutation({
    mutationFn: ({ telegram_id, status, blockReason }: { telegram_id: number; status: 'active' | 'blocked'; blockReason?: string }) =>
      setSellerStatus(telegram_id, status, blockReason),
    onSuccess: (_data, { status }) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'sellers'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'seller-detail'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
      pushToast(status === 'blocked' ? 'Продавец заблокирован' : 'Продавец разблокирован', status === 'blocked' ? 'dg' : 'ok')
      closeSheet()
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
