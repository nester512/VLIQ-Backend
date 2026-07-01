import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AdminReceipt } from '@/api/admin'
import type { Attachment } from '@/types/models'

// ---------------------------------------------------------------------------
// Module mocks — the sheet pulls in a swipe mutation + the UI store; neither is
// the subject under test (KAN-15 is about RENDERING the attachments + info card),
// so we stub them to keep the render synchronous and side-effect free.
// ---------------------------------------------------------------------------
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ closeSheet: vi.fn(), openSheet: vi.fn(), pushToast: vi.fn() }),
}))

vi.mock('@/features/admin/hooks/useReviewQueue', () => ({
  useSwipeAction: () => ({
    // Invoke the per-call callbacks so handleAction's onSuccess (cache
    // invalidation) and onSettled (closeSheet) actually run under test.
    mutate: (_args: unknown, opts?: { onSuccess?: () => void; onSettled?: () => void }) => {
      opts?.onSuccess?.()
      opts?.onSettled?.()
    },
    isPending: false,
  }),
}))

// The sheet's write actions call these — stub them as resolved no-ops so the
// mutations' onSuccess (cache invalidation) runs without a real network call.
vi.mock('@/api/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/admin')>()),
  editReceiptBonus: vi.fn(() => Promise.resolve()),
  addReceiptComment: vi.fn(() => Promise.resolve()),
  blockSeller: vi.fn(() => Promise.resolve()),
  deleteReceipt: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/components/molecules/RejectReasonSheet', () => ({
  RejectReasonSheet: ({
    open,
    onConfirm,
  }: {
    open: boolean
    onConfirm: (reason: string) => void
  }) =>
    open
      ? <button type="button" onClick={() => onConfirm('Некорректный чек')}>confirm-reject</button>
      : null,
}))

import { ReceiptDetailSheet } from './ReceiptDetailSheet'

afterEach(cleanup)

function img(over: Partial<Attachment> = {}): Attachment {
  return { id: 1, position: 0, kind: 'image', mime_type: 'image/jpeg', url: 'https://x/1.jpg', ...over }
}

function receipt(over: Partial<AdminReceipt> = {}): AdminReceipt {
  return {
    id: '7',
    seller_id: 9,
    status: 'on_review',
    seller_name: 'Иван Петров',
    seller_store: 'ТЦ Радуга',
    amount: 100000,
    bonus_amount: 2000,
    created_at: '2026-06-20T10:00:00Z',
    attachments: [img({ id: 1, position: 0 }), img({ id: 2, position: 1 })],
    ...over,
  }
}

function renderSheet(r: AdminReceipt) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return render(<ReceiptDetailSheet receiptId={r.id} receipt={r} />, { wrapper: Wrapper })
}

describe('ReceiptDetailSheet (KAN-15 Entity View)', () => {
  it('renders the attachments viewer and the receipt info card', () => {
    renderSheet(receipt())
    // Attachment viewer present (2 attachments → nav exists).
    expect(screen.getByTestId('attachment-viewer')).toBeInTheDocument()
    expect(screen.getByLabelText('Следующее вложение')).toBeInTheDocument()
    // The info card section renders the seller + store.
    const infoCard = screen.getByTestId('receipt-info-card')
    expect(infoCard).toHaveTextContent('Иван Петров')
    expect(infoCard).toHaveTextContent('ТЦ Радуга')
  })

  it('exposes the info card as the viewer final page when there are attachments', () => {
    renderSheet(receipt())
    // At mount only the section-below info card exists (viewer shows page 1).
    expect(screen.getAllByTestId('receipt-info-card').length).toBe(1)
    // Navigate past both attachments → the viewer's finalCard page mounts a
    // SECOND copy of the info card.
    fireEvent.click(screen.getByLabelText('Следующее вложение'))
    fireEvent.click(screen.getByLabelText('Следующее вложение'))
    expect(screen.getByTestId('attachment-final-card')).toBeInTheDocument()
    expect(screen.getAllByTestId('receipt-info-card').length).toBe(2)
  })

  it('shows the system rejection reason + code for a rejected receipt', () => {
    const infoCard = within(
      renderSheet(
        receipt({
          status: 'rejected',
          rejection_code: 'MULTIPLE_RECEIPTS_DETECTED',
          rejection_reason: 'На фото несколько разных чеков',
        }),
      ).container,
    ).getAllByTestId('receipt-info-card')[0]!
    expect(infoCard).toHaveTextContent('Причина отклонения:')
    expect(infoCard).toHaveTextContent('На фото несколько разных чеков')
    expect(infoCard).toHaveTextContent('MULTIPLE_RECEIPTS_DETECTED')
  })

  it('falls back gracefully (no crash, shows the mock) for a legacy receipt with no attachments', () => {
    renderSheet(receipt({ attachments: [] }))
    // Viewer still mounts (emptyFallback), no nav, and the "макет" hint shows.
    expect(screen.getByTestId('attachment-viewer')).toBeInTheDocument()
    expect(screen.queryByLabelText('Следующее вложение')).toBeNull()
    expect(screen.getByText('Фото чека недоступно — показан макет')).toBeInTheDocument()
    // The full info card below the viewer still renders.
    expect(screen.getByTestId('receipt-info-card')).toBeInTheDocument()
  })
})

describe('ReceiptDetailSheet — actualizes views after a status change', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reject refetches the review queue so the deck drops the actioned card', () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderSheet(receipt({ status: 'on_review' }))
    fireEvent.click(screen.getByText('Отклонить'))
    fireEvent.click(screen.getByText('confirm-reject'))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'review-queue'] })
  })

  it('delete refetches the seller-receipts list + review queue (not the dead key)', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderSheet(receipt({ status: 'rejected' }))
    fireEvent.click(screen.getByText('Удалить чек'))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'seller-receipts'] }),
    )
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'review-queue'] })
    // The old ['admin','receipts'] key matched no query — must not be used.
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['admin', 'receipts'] })
  })
})
