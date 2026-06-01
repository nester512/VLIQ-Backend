import { useQuery } from '@tanstack/react-query'
import { listPromotions } from '@/api/promotions'

export function usePromotions() {
  return useQuery({
    queryKey: ['promotions'],
    queryFn: listPromotions,
    staleTime: 60_000,
  })
}
