import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SwipeDeck } from '@/components/organisms/SwipeDeck'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { RejectReasonSheet } from '@/components/molecules/RejectReasonSheet'
import { useUiStore } from '@/store/uiStore'
import { extractApiError } from '@/api/client'
import {
  useReviewQueue,
  useSwipeAction,
  flattenReceiptPages,
  type SwipeDirection,
} from '@/features/admin/hooks/useReviewQueue'
import type { AdminReceipt } from '@/api/admin'

function ReviewContent() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } = useReviewQueue()
  const { mutate: swipeAction, isPending: isSwipePending } = useSwipeAction()
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)

  const receipts = flattenReceiptPages(data)

  // Local state for the reject reason sheet
  const [rejectingReceiptId, setRejectingReceiptId] = useState<string | null>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)
  // Bumped when the admin cancels the reject sheet OR a swipe action fails →
  // SwipeDeck rolls back the last optimistic advance and re-shows the card.
  // Without this the card visually vanishes from the deck even though the
  // mutation was rejected (e.g. 409: the receipt changed status under the admin),
  // leaving it gone in a false-success state.
  const [undoTrigger, setUndoTrigger] = useState(0)

  const handleSwipe = useCallback(
    (id: string, dir: SwipeDirection) => {
      if (dir === 'reject') {
        // Intercept: open reason sheet instead of firing immediately
        setRejectingReceiptId(id)
        setRejectError(null)
        return
      }
      swipeAction(
        { id, dir },
        {
          // The localized toast is dispatched by useSwipeAction's mutation-level
          // onError — this per-call handler only repairs the optimistic UI so we
          // don't double-toast.
          onError: (err: unknown) => {
            const { status } = extractApiError(err)
            // The SwipeDeck already advanced optimistically. The action failed,
            // so roll that advance back and re-show the card. On a 409 the card's
            // status changed under the admin — refetch the queue so the stale
            // card is replaced with fresh data rather than re-shown indefinitely.
            setUndoTrigger((t) => t + 1)
            if (status === 409) {
              void queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
            }
          },
        },
      )
      // Prefetch next page when approaching end
      if (receipts.length - receipts.findIndex((r) => r.id === id) < 5 && hasNextPage) {
        void fetchNextPage()
      }
    },
    [swipeAction, receipts, hasNextPage, fetchNextPage, queryClient],
  )

  const handleTap = useCallback(
    (receiptId: string) => {
      const receipt = receipts.find((r) => r.id === receiptId) as AdminReceipt | undefined
      openSheet('detail', { receiptId, receipt })
    },
    [receipts, openSheet],
  )

  function handleRejectConfirm(reason: string) {
    if (!rejectingReceiptId) return
    const id = rejectingReceiptId
    setRejectError(null)
    swipeAction(
      { id, dir: 'reject', comment: reason },
      {
        onSuccess: () => {
          setRejectingReceiptId(null)
          // Prefetch next page when approaching end
          if (receipts.length - receipts.findIndex((r) => r.id === id) < 5 && hasNextPage) {
            void fetchNextPage()
          }
        },
        onError: (err: unknown) => {
          const { userMessage, status } = extractApiError(err)
          setRejectError(userMessage)
          pushToast(userMessage, 'dg')
          // On a 409 the receipt changed status under the admin (already
          // actioned elsewhere) — roll back the optimistic deck advance and
          // refetch so the stale card isn't left gone in a false-success state.
          if (status === 409) {
            setUndoTrigger((t) => t + 1)
            void queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
          }
        },
      },
    )
  }

  function handleRejectClose() {
    setRejectingReceiptId(null)
    setRejectError(null)
    // Roll back the SwipeDeck advance so the cancelled card reappears.
    setUndoTrigger((t) => t + 1)
  }

  return (
    // SwipeDeck uses position:absolute inset:0 internally — need relative container
    // vliq-review-wrap/vliq-review-deck center the card on desktop (≥1280px)
    <div className="relative h-full vliq-review-wrap">
      <div className="vliq-review-deck h-full">
        <SwipeDeck
          receipts={receipts}
          onSwipe={handleSwipe}
          onTap={handleTap}
          isLoading={isLoading || isFetchingNextPage}
          undoTrigger={undoTrigger}
        />
      </div>
      <RejectReasonSheet
        open={rejectingReceiptId !== null}
        onClose={handleRejectClose}
        onConfirm={handleRejectConfirm}
        isSubmitting={isSwipePending}
      />
      {rejectError && null /* error is surfaced via toast */}
    </div>
  )
}

export function ReviewPage() {
  return (
    <ErrorBoundary>
      <ReviewContent />
    </ErrorBoundary>
  )
}
