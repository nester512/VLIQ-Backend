import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createPayoutRequest } from '@/api/payouts'
import type { CreatePayoutPayload } from '@/api/payouts'
import { extractApiError } from '@/api/client'
import { useUiStore } from '@/store/uiStore'

/**
 * The caller passes ONE idempotency key per filled-in form: a double tap or a
 * network retry sends the same key and the server returns the same request
 * (UNIQUE per seller in the DB) instead of creating a second one.
 */
export function useRequestPayout() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)

  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: { payload: CreatePayoutPayload; idempotencyKey: string }) =>
      createPayoutRequest(payload, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['balance'] })
      void queryClient.invalidateQueries({ queryKey: ['payouts', 'me'] })
      void queryClient.invalidateQueries({ queryKey: ['bonus-transactions'] })
      pushToast('Заявка на выплату создана', 'ok')
    },
    onError: (err) => {
      pushToast(extractApiError(err).userMessage, 'dg')
    },
  })
}
