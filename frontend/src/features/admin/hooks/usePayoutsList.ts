import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAdminPayouts,
  getPayoutReceipts,
  getPayoutSummary,
  approvePayoutRequest,
  rejectPayoutRequest,
  takePayoutRequest,
  type AdminPayoutsFilters,
} from '@/api/admin'
import { useUiStore } from '@/store/uiStore'
import { extractApiError } from '@/api/client'
import { invalidateAfterPayoutChange } from '@/features/admin/invalidate'
import type { PayoutRequest } from '@/types/models'

export const PAYOUTS_PAGE_SIZE = 50

/** Every payout request under the filters, page by page (infinite scroll) — not just the first page. */
export function usePayoutsInfinite(filters: Omit<AdminPayoutsFilters, 'page' | 'limit'> = {}) {
  return useInfiniteQuery({
    queryKey: ['admin', 'payouts', 'infinite', filters],
    queryFn: ({ pageParam }) => getAdminPayouts({ ...filters, page: pageParam as number, limit: PAYOUTS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    staleTime: 20_000,
  })
}

/** Totals over every request (server-side) — not the sum of a loaded page. */
export function usePayoutSummary() {
  return useQuery({
    queryKey: ['admin', 'payouts', 'summary'],
    queryFn: () => getPayoutSummary(),
    staleTime: 20_000,
  })
}

export function usePayoutReceipts(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'payouts', 'receipts', id],
    queryFn: () => getPayoutReceipts(id!),
    enabled: id != null,
    staleTime: 20_000,
  })
}

export function usePayoutActions(onChanged?: (p: PayoutRequest) => void) {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const closeSheet = useUiStore((s) => s.closeSheet)
  const onError = (err: unknown) => pushToast(extractApiError(err).userMessage, 'dg')

  const take = useMutation({
    mutationFn: (id: string) => takePayoutRequest(id),
    onSuccess: (p) => {
      invalidateAfterPayoutChange(queryClient)
      onChanged?.(p)
      pushToast('Заявка взята в работу', 'ok')
    },
    onError,
  })

  const approve = useMutation({
    mutationFn: ({ id, externalTxnId }: { id: string; externalTxnId?: string }) => approvePayoutRequest(id, externalTxnId),
    onSuccess: () => {
      invalidateAfterPayoutChange(queryClient)
      closeSheet()
      pushToast('Отмечено «Выплачено» — продавцу отправлено уведомление', 'ok')
    },
    onError,
  })

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectPayoutRequest(id, reason),
    onSuccess: () => {
      invalidateAfterPayoutChange(queryClient)
      closeSheet()
      pushToast('Заявка отклонена, сумма вернулась продавцу', 'dg')
    },
    onError,
  })

  return { take, approve, reject }
}
