import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createPayoutRequest } from '@/api/payouts'
import type { CreatePayoutPayload } from '@/api/payouts'
import { useUiStore } from '@/store/uiStore'

export function useRequestPayout() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)

  return useMutation({
    mutationFn: (payload: CreatePayoutPayload) => {
      const idempotencyKey = crypto.randomUUID()
      return createPayoutRequest(payload, idempotencyKey)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['balance'] })
      pushToast('Заявка на выплату создана', 'ok')
    },
    onError: () => {
      pushToast('Ошибка создания заявки. Попробуйте снова.', 'dg')
    },
  })
}
