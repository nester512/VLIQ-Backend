import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminReceipt, AdminSellerDetail } from '@/api/admin'

const { getAdminSellerById, getAdminReceipts, blockSeller, unblockSeller, openSheet } = vi.hoisted(() => ({
  getAdminSellerById: vi.fn(),
  getAdminReceipts: vi.fn(),
  blockSeller: vi.fn(),
  unblockSeller: vi.fn(),
  openSheet: vi.fn(),
}))
vi.mock('@/api/admin', () => ({ getAdminSellerById, getAdminReceipts, blockSeller, unblockSeller }))
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: object) => unknown) => selector({ openSheet, pushToast: vi.fn(), closeSheet: vi.fn() }),
}))

import { SellerReceiptsPage } from './SellerReceiptsPage'

function detail(overrides: Partial<AdminSellerDetail> = {}): AdminSellerDetail {
  return {
    id: 555,
    telegram_id: 555,
    first_name: 'Анна',
    last_name: 'Рискова',
    phone: '+79990000000',
    city: 'Казань',
    store_name: 'Точка',
    is_active: true,
    status: 'active',
    registered_at: '2026-01-01T00:00:00Z',
    balance: 150_000,
    receipts_total: 20,
    receipts_approved: 10,
    total_accrued: 300_000,
    total_paid_out: 100_000,
    on_hold: 50_000,
    avg_bonus: 15_000,
    weekly_activity: Array.from({ length: 12 }, (_, i) => ({
      week_start: `2026-07-${String(i + 1).padStart(2, '0')}`,
      receipts: i,
      approved: Math.floor(i / 2),
    })),
    stats: {
      receipts_total: 20,
      receipts_approved: 10,
      receipts_rejected: 8,
      receipts_on_review: 2,
      receipts_30d: 6,
      receipts_duplicates: 3,
      first_receipt_at: '2026-01-02T00:00:00Z',
      last_receipt_at: '2026-10-01T00:00:00Z',
      risk_score: 52,
      risk_level: 'high',
      risk_flags: ['high_reject_rate', 'duplicates'],
    },
    ...overrides,
  }
}

function receipt(id: number, status: AdminReceipt['status'] = 'approved'): AdminReceipt {
  return { id: String(id), seller_id: 555, status, shop_name: `Магазин ${id}`, created_at: '2026-10-01T10:00:00Z', attachments: [] } as AdminReceipt
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/sellers/555/receipts']}>
        <Routes>
          <Route path="/admin/sellers/:telegramId/receipts" element={<SellerReceiptsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SellerReceiptsPage — seller page with stats, risk and full history', () => {
  it('renders balance breakdown, receipt stats and the risk factor with reasons', async () => {
    getAdminSellerById.mockResolvedValue(detail())
    getAdminReceipts.mockResolvedValue({ items: [], total: 0, page: 1, limit: 30, has_more: false })
    renderPage()

    expect(await screen.findByText('Анна Рискова')).toBeInTheDocument()
    expect(screen.getByText('Начислено всего')).toBeInTheDocument()
    expect(screen.getByText('На удержании')).toBeInTheDocument()
    expect(screen.getByText('Средний бонус')).toBeInTheDocument()
    expect(screen.getByText('За 30 дней')).toBeInTheDocument()
    expect(screen.getByText('Высокий риск · 52')).toBeInTheDocument()
    expect(screen.getByText('Высокая доля отклонённых чеков')).toBeInTheDocument()
    expect(screen.getByText('Есть чеки с признаками дубля')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Активность по неделям/ })).toBeInTheDocument()
  })

  it('loads ALL statuses newest-first and filters by status', async () => {
    getAdminSellerById.mockResolvedValue(detail())
    getAdminReceipts.mockResolvedValue({ items: [receipt(1), receipt(2, 'rejected')], total: 2, page: 1, limit: 30, has_more: false })
    renderPage()

    expect(await screen.findByText(/Магазин 1/)).toBeInTheDocument()
    expect(getAdminReceipts).toHaveBeenCalledWith({ seller_id: 555, status: undefined, order: 'desc', page: 1, limit: 30 })

    fireEvent.click(screen.getByRole('button', { name: 'Отклонены' }))
    await waitFor(() =>
      expect(getAdminReceipts).toHaveBeenLastCalledWith({ seller_id: 555, status: ['rejected'], order: 'desc', page: 1, limit: 30 }),
    )
  })

  it('every row shows the backend receipt id — with or without a shop name', async () => {
    getAdminSellerById.mockResolvedValue(detail())
    const noShop = { ...receipt(42), shop_name: undefined } as AdminReceipt
    getAdminReceipts.mockResolvedValue({ items: [receipt(7), noShop], total: 2, page: 1, limit: 30, has_more: false })
    renderPage()

    const ids = await screen.findAllByTestId('receipt-id')
    expect(ids.map((el) => el.textContent)).toEqual(['Чек #7', 'Чек #42'])
    expect(ids[0]!.parentElement).toHaveTextContent('Чек #7 · Магазин 7')
  })

  it('pages through the history', async () => {
    getAdminSellerById.mockResolvedValue(detail())
    getAdminReceipts.mockImplementation(({ page }: { page: number }) =>
      Promise.resolve(
        page === 1
          ? { items: [receipt(1)], total: 2, page: 1, limit: 30, has_more: true }
          : { items: [receipt(2)], total: 2, page: 2, limit: 30, has_more: false },
      ),
    )
    renderPage()
    await screen.findByText(/Магазин 1/)

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }))

    expect(await screen.findByText(/Магазин 2/)).toBeInTheDocument()
  })

  it('opens the receipt sheet from the history', async () => {
    getAdminSellerById.mockResolvedValue(detail())
    getAdminReceipts.mockResolvedValue({ items: [receipt(9)], total: 1, page: 1, limit: 30, has_more: false })
    renderPage()

    fireEvent.click(await screen.findByText(/Магазин 9/))

    expect(openSheet).toHaveBeenCalledWith('detail', expect.objectContaining({ receiptId: '9' }))
  })

  it('unblocks through POST /unblock (not PATCH)', async () => {
    getAdminSellerById.mockResolvedValue(detail({ status: 'blocked', is_active: false, block_reason: 'Дубли' }))
    getAdminReceipts.mockResolvedValue({ items: [], total: 0, page: 1, limit: 30, has_more: false })
    unblockSeller.mockResolvedValue({})
    renderPage()

    expect(await screen.findByText('Дубли')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Разблокировать/ }))

    await waitFor(() => expect(unblockSeller).toHaveBeenCalledWith('555'))
    expect(blockSeller).not.toHaveBeenCalled()
  })
})
