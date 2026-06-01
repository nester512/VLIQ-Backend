import { useQuery } from '@tanstack/react-query'
import { getMyBalance } from '@/api/sellers'

export function useBalance() {
  return useQuery({
    queryKey: ['balance', 'me'],
    queryFn: getMyBalance,
    staleTime: 30_000,
  })
}
