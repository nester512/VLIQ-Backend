import { useQuery } from '@tanstack/react-query'
import { getSbpBanks } from '@/api/payouts'

/** The NSPK bank list changes rarely — load once per app open. */
export function useSbpBanks() {
  return useQuery({ queryKey: ['sbp-banks'], queryFn: getSbpBanks, staleTime: Infinity, gcTime: Infinity })
}
