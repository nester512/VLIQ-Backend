import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
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
  rejectReceipt: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/components/molecules/RejectReasonSheet', () => ({
  RejectReasonSheet: ({
    open,
    onConfirm,
    copy,
  }: {
    open: boolean
    onConfirm: (reason: string) => void
    copy?: { title?: string }
  }) =>
    open
      ? <button type="button" aria-label={`reason: ${copy?.title ?? 'reject'}`} onClick={() => onConfirm('Некорректный чек')}>confirm-reject</button>
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
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
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

  it('a receipt without files (QR intake) shows no photo area and no mock — data only', () => {
    renderSheet(receipt({ attachments: [], source: 'telegram_scan' }))
    expect(screen.queryByTestId('attachment-viewer')).toBeNull()
    expect(screen.queryByText(/макет/)).toBeNull()
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

  it('delete refreshes every view that shows receipts', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    renderSheet(receipt({ status: 'rejected' }))
    fireEvent.click(screen.getByText('Удалить чек'))
    fireEvent.click(screen.getByRole('button', { name: 'reason: Удалить чек' })) // the reason sheet
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'seller-receipts'] }),
    )
    for (const key of ['review-queue', 'receipts', 'sellers', 'seller-detail', 'dashboard']) {
      // ['admin','receipts'] IS live: the «Все чеки» archive (AdminReceiptsPage) uses it.
      expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', key] })
    }
  })
})

describe('ReceiptDetailSheet — navigation to the seller page', () => {
  function renderWithRoutes(r: AdminReceipt) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <MemoryRouter initialEntries={['/admin/review']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/admin/review" element={<ReceiptDetailSheet receiptId={r.id} receipt={r} />} />
            <Route path="/admin/sellers/:telegramId/receipts" element={<SellerPageProbe />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    )
  }

  it('«К продавцу» opens the seller page (stats + previous receipts), not a sheet swap', async () => {
    renderWithRoutes(receipt())
    fireEvent.click(screen.getByRole('button', { name: /К продавцу/ }))
    expect(await screen.findByText('seller-page:9')).toBeInTheDocument()
  })

  it('the seller name in the info card links to the same page', async () => {
    renderWithRoutes(receipt())
    fireEvent.click(within(screen.getByTestId('receipt-info-card')).getAllByRole('button', { name: /Открыть продавца/ })[0]!)
    expect(await screen.findByText('seller-page:9')).toBeInTheDocument()
  })
})

function SellerPageProbe() {
  const { telegramId } = useParams()
  return <div>seller-page:{telegramId}</div>
}

describe('ReceiptDetailSheet — money already moved: only with a reason', () => {
  it('delete asks for a reason and sends it', async () => {
    const { deleteReceipt } = await import('@/api/admin')
    renderSheet(receipt({ status: 'paid_out' }))
    fireEvent.click(screen.getByText('Удалить чек'))
    fireEvent.click(screen.getByRole('button', { name: 'reason: Удалить чек' }))
    await waitFor(() => expect(deleteReceipt).toHaveBeenCalledWith('7', 'Некорректный чек'))
  })

  it('an approved receipt can be cancelled — the bonus is taken back with the reason', async () => {
    const { rejectReceipt } = await import('@/api/admin')
    renderSheet(receipt({ status: 'approved' }))
    fireEvent.click(screen.getByText('Отменить чек — списать бонус'))
    fireEvent.click(screen.getByRole('button', { name: 'reason: Отменить чек' }))
    await waitFor(() => expect(rejectReceipt).toHaveBeenCalledWith('7', 'Некорректный чек'))
  })

  it('an on_review receipt has no cancel / delete', () => {
    renderSheet(receipt({ status: 'on_review' }))
    expect(screen.queryByText('Отменить чек — списать бонус')).toBeNull()
    expect(screen.queryByText('Удалить чек')).toBeNull()
  })
})
