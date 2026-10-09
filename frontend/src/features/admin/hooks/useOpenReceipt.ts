import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getAdminReceipt } from '@/api/admin'
import { extractApiError } from '@/api/client'
import { useUiStore } from '@/store/uiStore'

/** Open any receipt's sheet by id (from a payout, a duplicate…) — loads it first. */
export function useOpenReceipt() {
  const qc = useQueryClient()
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)
  return useCallback(
    async (id: string | number) => {
      try {
        const receipt = await qc.fetchQuery({
          queryKey: ['admin', 'receipts', 'one', Number(id)],
          queryFn: () => getAdminReceipt(id),
          staleTime: 30_000,
        })
        openSheet('detail', { receiptId: receipt.id, receipt })
      } catch (err) {
        pushToast(extractApiError(err).userMessage, 'dg')
      }
    },
    [qc, openSheet, pushToast],
  )
}
