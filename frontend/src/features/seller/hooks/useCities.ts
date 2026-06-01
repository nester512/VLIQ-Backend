import { useQuery } from '@tanstack/react-query'
import { getCities } from '@/api/cities'

/** Allowed-cities dictionary. Effectively static, so cache aggressively. */
export function useCities() {
  return useQuery({
    queryKey: ['cities'],
    queryFn: getCities,
    staleTime: 24 * 60 * 60 * 1000,
  })
}
