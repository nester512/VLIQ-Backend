import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAdminReceipts,
  approveReceipt,
  rejectReceipt,
  reviseReceipt,
  type AdminReceipt,
} from '@/api/admin'
import { useUiStore } from '@/store/uiStore'
import { useHaptic } from '@/hooks/useHaptic'
import { extractApiError } from '@/api/client'

// Only `on_review` is *actionable*. `pending` receipts are still inside the
// pipeline worker (no decision possible yet). `needs_revision` is a terminal
// state for the seller to re-upload — admin can't approve from here.
// Including them in the queue led to 409 RECEIPT_INVALID_STATE_TRANSITION
// when admins swiped on cards that weren't actually reviewable.
const REVIEW_STATUSES = ['on_review']
const PAGE_LIMIT = 20

export function useReviewQueue() {
  return useInfiniteQuery({
    queryKey: ['admin', 'review-queue'],
    queryFn: ({ pageParam = 1 }) =>
      getAdminReceipts({
        status: REVIEW_STATUSES,
        page: pageParam as number,
        limit: PAGE_LIMIT,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.page + 1 : undefined,
    staleTime: 30_000,
  })
}

export type SwipeDirection = 'approve' | 'reject' | 'revise'

interface SwipeActionArgs {
  id: string
  dir: SwipeDirection
  comment?: string
}

export function useSwipeAction() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const { impact, notification } = useHaptic()

  return useMutation({
    mutationFn: ({ id, dir, comment }: SwipeActionArgs) => {
      if (dir === 'approve') return approveReceipt(id)
      if (dir === 'reject') return rejectReceipt(id, comment)
      return reviseReceipt(id, comment ?? '')
    },
    onSuccess: (_, { dir }) => {
      // Invalidate the review queue and the dashboard (which also queries receipts).
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] })

      if (dir === 'approve') {
        impact('medium')
        pushToast('Чек одобрен · бонус начислен', 'ok')
      } else if (dir === 'reject') {
        notification('error')
        pushToast('Чек отклонён', 'dg')
      } else {
        notification('warning')
        pushToast('Отправлен на доработку', 'wn')
      }
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })
}

/** Flatten pages from infinite query into a flat list. Safe against undefined/null items. */
export function flattenReceiptPages(
  data: { pages: Array<{ items?: AdminReceipt[] | null } | null | undefined> } | undefined,
): AdminReceipt[] {
  if (!data?.pages) return []
  return data.pages
    .flatMap((page) => (page?.items ?? []))
    .filter((r): r is AdminReceipt => Boolean(r && r.id))
}
