import { useQuery } from '@tanstack/react-query'
import { getMyReceipts, getReceipt } from '@/api/receipts'
import type { ReceiptsFilters } from '@/api/receipts'

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
