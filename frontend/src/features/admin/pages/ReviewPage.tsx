import { useCallback, useState } from 'react'
import { SwipeDeck } from '@/components/organisms/SwipeDeck'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { RejectReasonSheet } from '@/components/molecules/RejectReasonSheet'
import { useUiStore } from '@/store/uiStore'
import {
  useReviewQueue,
  useSwipeAction,
  flattenReceiptPages,
  type SwipeDirection,
} from '@/features/admin/hooks/useReviewQueue'
import type { AdminReceipt } from '@/api/admin'

function ReviewContent() {
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } = useReviewQueue()
  const { mutate: swipeAction, isPending: isSwipePending } = useSwipeAction()
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)

  const receipts = flattenReceiptPages(data)

  // Local state for the reject reason sheet
  const [rejectingReceiptId, setRejectingReceiptId] = useState<string | null>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)
  // Bumped when the admin cancels the reject sheet → SwipeDeck rolls back the
  // last optimistic advance and re-shows the card. Without this the card
  // visually vanishes from the deck even though no mutation was sent.
  const [undoTrigger, setUndoTrigger] = useState(0)

  const handleSwipe = useCallback(
    (id: string, dir: SwipeDirection) => {
      if (dir === 'reject') {
        // Intercept: open reason sheet instead of firing immediately
        setRejectingReceiptId(id)
        setRejectError(null)
        return
      }
      swipeAction({ id, dir })
      // Prefetch next page when approaching end
      if (receipts.length - receipts.findIndex((r) => r.id === id) < 5 && hasNextPage) {
        void fetchNextPage()
      }
    },
    [swipeAction, receipts, hasNextPage, fetchNextPage],
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
          const msg =
            (err as { userMessage?: string })?.userMessage ??
            (err instanceof Error ? err.message : null) ??
            'Ошибка при отклонении чека'
          setRejectError(msg)
          pushToast(msg, 'dg')
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
