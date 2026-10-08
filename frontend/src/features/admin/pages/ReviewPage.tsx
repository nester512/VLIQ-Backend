import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { SwipeDeck } from '@/components/organisms/SwipeDeck'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { RejectReasonSheet } from '@/components/molecules/RejectReasonSheet'
import { EditBonusSheet } from '@/components/molecules/EditBonusSheet'
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
  const navigate = useNavigate()
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)

  const receipts = flattenReceiptPages(data)

  // Capture the backlog total ONCE per session so the deck's "N / total"
  // counter has a STABLE denominator. Detail-sheet actions refetch the queue
  // and shrink the live on_review total, which would otherwise desync against
  // the cumulative session numerator and prematurely pin the counter to N/N.
  // Resets on re-entry (this component remounts per route).
  const rawReviewTotal = data?.pages?.[0]?.total
  // Hold the FIRST backlog total this session stable (useState, captured once
  // via effect — never read/write a ref during render). Detail-sheet actions
  // refetch and shrink the live on_review total, which would otherwise desync
  // the cumulative session numerator and prematurely pin the counter to N/N.
  // Resets on re-entry (this component remounts per route).
  const [capturedTotal, setCapturedTotal] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (capturedTotal === undefined && typeof rawReviewTotal === 'number') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- capture-once
      setCapturedTotal(rawReviewTotal)
    }
  }, [rawReviewTotal, capturedTotal])
  const reviewTotal = capturedTotal ?? rawReviewTotal

  // Local state for the reject reason sheet
  const [rejectingReceiptId, setRejectingReceiptId] = useState<string | null>(null)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [approvingReceiptId, setApprovingReceiptId] = useState<string | null>(null)
  // Bumped when the admin cancels the reject sheet OR a swipe action fails →
  // SwipeDeck rolls back the last optimistic advance and re-shows the card.
  // Without this the card visually vanishes from the deck even though the
  // mutation was rejected (e.g. 409: the receipt changed status under the admin),
  // leaving it gone in a false-success state.
  const [undoTrigger, setUndoTrigger] = useState(0)

  // Keeping the review-queue cache across re-entry would re-show already-checked
  // cards during the background refetch (and let them be swiped into a 409).
  // Drop the query on unmount so reopening starts fresh (skeleton → refetch),
  // which is what makes checked receipts actually leave the deck on re-entry.
  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ['admin', 'review-queue'] })
    }
  }, [queryClient])

  const handleSwipe = useCallback(
    (id: string, dir: SwipeDirection) => {
      const receipt = receipts.find((r) => r.id === id)
      if (receipt?.status !== 'on_review') {
        pushToast('Чек ещё обрабатывается. Откройте карточку для просмотра данных.', 'wn')
        setUndoTrigger((t) => t + 1)
        return
      }
      if (dir === 'reject') {
        // Intercept: open reason sheet instead of firing immediately
        setRejectingReceiptId(id)
        setRejectError(null)
        return
      }
      if (dir === 'approve' && (receipt?.bonus_amount ?? 0) <= 0) {
        // Per updated flow: if recognition didn't produce a bonus, admin must
        // enter it before confirmation. Closing this sheet rolls the deck back.
        setApprovingReceiptId(id)
        return
      }
      swipeAction(
        { id, dir },
        {
          // The localized toast is dispatched by useSwipeAction's mutation-level
          // onError — this per-call handler only repairs the optimistic UI so we
          // don't double-toast.
          onError: () => {
            // The SwipeDeck already advanced optimistically. The action failed,
            // so roll that advance back and re-show the card. No mid-session
            // review-queue refetch here — the stale card is refreshed on
            // re-entry (the query is removed on unmount).
            setUndoTrigger((t) => t + 1)
          },
        },
      )
      // Prefetch next page when approaching end
      if (receipts.length - receipts.findIndex((r) => r.id === id) < 5 && hasNextPage) {
        void fetchNextPage()
      }
    },
    [swipeAction, receipts, hasNextPage, fetchNextPage, pushToast],
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
          // On a 409 the receipt changed status under the admin — roll back the
          // optimistic advance. No mid-session review-queue refetch (it would skip
          // unprocessed cards); the stale card is refreshed on re-entry.
          if (status === 409) {
            setUndoTrigger((t) => t + 1)
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

  function prefetchIfNearEnd(id: string) {
    if (receipts.length - receipts.findIndex((r) => r.id === id) < 5 && hasNextPage) {
      void fetchNextPage()
    }
  }

  function handleApproveBonusConfirm(amountKopecks: number) {
    if (!approvingReceiptId) return
    const id = approvingReceiptId
    swipeAction(
      { id, dir: 'approve', bonusAmountKopecks: amountKopecks },
      {
        onSuccess: () => {
          setApprovingReceiptId(null)
          prefetchIfNearEnd(id)
        },
        onError: () => {
          // Roll back the advance. No mid-session review-queue refetch (skip hazard);
          // refreshed on re-entry.
          setApprovingReceiptId(null)
          setUndoTrigger((t) => t + 1)
        },
      },
    )
  }

  function handleApproveBonusClose() {
    setApprovingReceiptId(null)
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
          totalCount={reviewTotal}
          onSellerClick={(sellerId) => navigate(`/admin/sellers/${sellerId}/receipts`)}
          onSkip={(id) => {
            // Skipping walks the deck like a decision does: keep the next page coming.
            if (receipts.length - receipts.findIndex((r) => r.id === id) < 5 && hasNextPage) void fetchNextPage()
          }}
        />
      </div>
      <RejectReasonSheet
        open={rejectingReceiptId !== null}
        onClose={handleRejectClose}
        onConfirm={handleRejectConfirm}
        isSubmitting={isSwipePending}
      />
      <EditBonusSheet
        open={approvingReceiptId !== null}
        onClose={handleApproveBonusClose}
        onConfirm={handleApproveBonusConfirm}
        isSubmitting={isSwipePending}
        title="Укажите бонус"
        confirmLabel="Подтвердить"
        submittingLabel="Подтверждение…"
        requirePositive
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
