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
import { invalidateAfterReceiptChange } from '@/features/admin/invalidate'

// Confluence A2 invariant: the active dating-style review feed contains only
// actionable receipts. Seller-facing `pending` / `ocr_in_progress` still render
// as «На проверке», but they must not enter this deck: they are not swipeable
// and would block older `on_review` receipts behind them.
export const REVIEW_QUEUE_STATUSES = ['on_review'] as const
const PAGE_LIMIT = 20

export function useReviewQueue() {
  return useInfiniteQuery({
    queryKey: ['admin', 'review-queue'],
    queryFn: ({ pageParam = 1 }) =>
      getAdminReceipts({
        status: [...REVIEW_QUEUE_STATUSES],
        page: pageParam as number,
        limit: PAGE_LIMIT,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.page + 1 : undefined,
    staleTime: 30_000,
    // The deck consumes a per-session snapshot; freshness comes on re-entry
    // (ReviewPage removes this query on unmount, so the next mount fetches from
    // scratch and shows the skeleton, never stale cards). Disabling automatic
    // mid-session refetch keeps the deck stable while the admin works; the deck
    // itself is refetch-safe now (id-based consumption), so this is belt-and-
    // suspenders rather than load-bearing.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}

export type SwipeDirection = 'approve' | 'reject' | 'revise'

interface SwipeActionArgs {
  id: string
  dir: SwipeDirection
  comment?: string
  bonusAmountKopecks?: number
}

export function useSwipeAction() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const { impact, notification } = useHaptic()

  return useMutation({
    mutationFn: ({ id, dir, comment, bonusAmountKopecks }: SwipeActionArgs) => {
      if (dir === 'approve') return approveReceipt(id, { comment, bonusAmountKopecks })
      if (dir === 'reject') return rejectReceipt(id, comment)
      return reviseReceipt(id, comment ?? '')
    },
    onSuccess: (_, { dir }) => {
      // The deck hides the just-swiped card locally by receipt id, so its own
      // queue is not refetched mid-session; every other view is.
      invalidateAfterReceiptChange(queryClient, { reviewQueue: false })

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
