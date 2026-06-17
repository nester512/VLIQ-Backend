import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAdminPayouts,
  approvePayoutRequest,
  rejectPayoutRequest,
  type AdminPayoutsFilters,
} from '@/api/admin'
import { useUiStore } from '@/store/uiStore'
import { extractApiError } from '@/api/client'

export function usePayoutsList(filters: AdminPayoutsFilters = {}) {
  return useQuery({
    queryKey: ['admin', 'payouts', filters],
    queryFn: () => getAdminPayouts(filters),
    staleTime: 20_000,
  })
}

export function usePayoutActions() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const closeSheet = useUiStore((s) => s.closeSheet)

  const approve = useMutation({
    mutationFn: (id: string) => approvePayoutRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] })
      // The dashboard's «Выплачено» counter is a SEPARATE query (['admin',
      // 'dashboard']) — invalidate it too, else it stays stale after marking
      // requests paid (mirrors useReviewQueue / useSellersList).
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
      closeSheet()
      pushToast('Выплата подтверждена', 'ok')
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })

  const reject = useMutation({
    mutationFn: (id: string) => rejectPayoutRequest(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'payouts'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] })
      closeSheet()
      pushToast('Заявка отклонена', 'dg')
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })

  return { approve, reject }
}
