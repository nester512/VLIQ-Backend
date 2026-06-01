import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listNotifications, markRead } from '@/api/notifications'
import type { Notification } from '@/types/models'

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications(),
    staleTime: 30_000,
  })
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markRead(id),
    // Optimistic: flip `read=true` in the cache immediately so the bell
    // badge and the row styling don't lag behind the refetch.
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['notifications'] })
      const prev = queryClient.getQueryData<Notification[]>(['notifications'])
      if (prev) {
        queryClient.setQueryData<Notification[]>(
          ['notifications'],
          prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
        )
      }
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['notifications'], ctx.prev)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}
