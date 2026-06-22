import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Mocks. We drive the REAL useReviewQueue / useSwipeAction and the REAL
// extractApiError so the 409 → optimistic-rollback path is exercised end to
// end. Only the network (@/api/admin), toasts, haptics, the heavy SwipeDeck
// canvas, and the ErrorBoundary's child wiring are replaced.
// ---------------------------------------------------------------------------

// One reviewable card sits in the queue.
const QUEUE = [{ id: '1', status: 'on_review', seller_name: 'Иван' }]

// approveReceipt rejects with a 409 envelope: the card changed status under the
// admin (RECEIPT_INVALID_STATE_TRANSITION) — the classic false-success case.
const approveReceipt = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const rejectReceipt = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
const reviseReceipt = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
vi.mock('@/api/admin', () => ({
  getAdminReceipts: vi.fn(() =>
    Promise.resolve({ items: QUEUE, page: 1, has_more: false }),
  ),
  approveReceipt: (...a: unknown[]) => approveReceipt(...a),
  rejectReceipt: (...a: unknown[]) => rejectReceipt(...a),
  reviseReceipt: (...a: unknown[]) => reviseReceipt(...a),
}))

const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast; openSheet: () => void }) => unknown) =>
    selector({ pushToast, openSheet: vi.fn() }),
}))

vi.mock('@/hooks/useHaptic', () => ({
  useHaptic: () => ({ impact: vi.fn(), notification: vi.fn() }),
}))

vi.mock('@/components/atoms/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/molecules/RejectReasonSheet', () => ({
  RejectReasonSheet: () => null,
}))

// Stand-in SwipeDeck: a button that fires onSwipe('1','approve') and a live
// readout of the undoTrigger prop so the test can assert the rollback.
vi.mock('@/components/organisms/SwipeDeck', () => ({
  SwipeDeck: ({
    onSwipe,
    undoTrigger,
  }: {
    onSwipe: (id: string, dir: string) => void
    undoTrigger: number
  }) =>
    createElement(
      'div',
      null,
      createElement('span', { 'data-testid': 'undo-trigger' }, String(undoTrigger)),
      createElement(
        'button',
        { type: 'button', onClick: () => onSwipe('1', 'approve') },
        'approve',
      ),
    ),
}))

import { ReviewPage } from './ReviewPage'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  render(
    createElement(QueryClientProvider, { client: queryClient }, createElement(ReviewPage)),
  )
  return { invalidateSpy }
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
})

describe('ReviewPage — 409 rollback', () => {
  it('rolls back the optimistic advance + shows a localized toast on a 409 swipe', async () => {
    approveReceipt.mockRejectedValueOnce({
      isAxiosError: true,
      code: undefined,
      response: {
        status: 409,
        data: {
          code: 'RECEIPT_INVALID_STATE_TRANSITION',
          user_message: 'Этот чек уже обработан другим админом.',
          debug_id: 'd-409',
        },
      },
    })

    const { invalidateSpy } = renderPage()

    // Wait for the queue to load and the deck stand-in to render.
    const swipeBtn = await screen.findByText('approve')
    expect(screen.getByTestId('undo-trigger').textContent).toBe('0')

    await userEvent.click(swipeBtn)

    // The mutation rejected → the per-call onError bumps undoTrigger (rollback)
    // and the mutation-level onError surfaces the localized message.
    await waitFor(() =>
      expect(screen.getByTestId('undo-trigger').textContent).toBe('1'),
    )
    expect(pushToast).toHaveBeenCalledWith('Этот чек уже обработан другим админом.', 'dg')

    // 409 → refetch the queue so the stale card is replaced.
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['admin', 'review-queue'] }),
    )
    // The English code must never reach the user.
    const toastMessages = pushToast.mock.calls.map((c) => c[0])
    expect(toastMessages.some((m) => String(m).includes('RECEIPT_INVALID_STATE_TRANSITION'))).toBe(
      false,
    )
  })
})
