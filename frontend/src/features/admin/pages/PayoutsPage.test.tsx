import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { PayoutRequest } from '@/types/models'

const { getAdminPayouts, getPayoutSummary } = vi.hoisted(() => ({ getAdminPayouts: vi.fn(), getPayoutSummary: vi.fn() }))
vi.mock('@/api/admin', () => ({
  getAdminPayouts, getPayoutSummary,
  getPayoutReceipts: vi.fn(), takePayoutRequest: vi.fn(), approvePayoutRequest: vi.fn(), rejectPayoutRequest: vi.fn(),
}))
vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: object) => unknown) => sel({ pushToast: vi.fn(), openSheet: vi.fn(), closeSheet: vi.fn() }),
}))

vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} })

import { PayoutsPage } from './PayoutsPage'

const row = (id: number): PayoutRequest => ({
  id: String(id), seller_id: 1, seller_name: `Продавец ${id}`, amount: 300_000, method: 'sbp_phone',
  details: '+79990000000', status: 'new', created_at: '2026-10-09T10:15:00Z',
})
const total = { count: 0, amount: 0 }

function renderPage() {
  getPayoutSummary.mockResolvedValue({
    new: { count: 120, amount: 36_000_000 }, in_progress: total, paid: total, rejected: total, paid_this_month: total,
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><MemoryRouter><PayoutsPage /></MemoryRouter></QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('PayoutsPage (admin)', () => {
  it('pages through every request, shows when each was created, totals from the server', async () => {
    getAdminPayouts
      .mockResolvedValueOnce({ items: [row(3), row(2)], total: 3, page: 1, limit: 50, has_more: true })
      .mockResolvedValueOnce({ items: [row(1)], total: 3, page: 2, limit: 50, has_more: false })
    renderPage()

    expect(await screen.findByText('Продавец 3')).toBeInTheDocument()
    expect(screen.getAllByTestId('payout-created')[0]).toHaveTextContent('09.10.2026')
    expect(await screen.findByText('новых 120')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Загрузить ещё/ }))
    expect(await screen.findByText('Продавец 1')).toBeInTheDocument()
    expect(getAdminPayouts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, order: 'desc' }))
  })

  it('«Сначала старые» asks the server for the oldest first', async () => {
    getAdminPayouts.mockResolvedValue({ items: [row(1)], total: 1, page: 1, limit: 50, has_more: false })
    renderPage()
    await screen.findByText('Продавец 1')

    fireEvent.click(screen.getByRole('button', { name: 'Сначала старые' }))
    await waitFor(() => expect(getAdminPayouts).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, order: 'asc' })))
  })
})
