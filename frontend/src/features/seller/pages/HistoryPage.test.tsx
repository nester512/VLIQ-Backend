import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { createElement, type ReactNode } from 'react'
import type { Receipt } from '@/types/models'
import type { ReceiptsPage } from '@/api/receipts'

const getMyReceiptsPage = vi.fn()
vi.mock('@/api/receipts', () => ({
  getMyReceiptsPage: (...a: unknown[]) => getMyReceiptsPage(...a),
  getMyReceipts: vi.fn(),
  getReceipt: vi.fn(),
}))

import { HistoryPage } from './HistoryPage'

function mkReceipts(from: number, to: number): Receipt[] {
  const out: Receipt[] = []
  for (let i = from; i <= to; i++) {
    out.push({
      id: String(i),
      seller_id: 9,
      status: 'on_review',
      shop_name: `Магазин ${i}`,
      amount: 1000,
      bonus_amount: 0,
      created_at: '2026-01-01T00:00:00Z',
    })
  }
  return out
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, children))
}

beforeEach(() => {
  getMyReceiptsPage.mockReset()
  getMyReceiptsPage.mockImplementation((filters: { page?: number }): Promise<ReceiptsPage> => {
    if ((filters.page ?? 1) === 1) {
      return Promise.resolve({ items: mkReceipts(1, 50), total: 55, page: 1, has_more: true })
    }
    return Promise.resolve({ items: mkReceipts(51, 55), total: 55, page: 2, has_more: false })
  })
})
afterEach(cleanup)

describe('HistoryPage — seller with 50+ receipts sees them all', () => {
  it('loads the first page, then loads the rest via "Загрузить ещё" (no receipts lost)', async () => {
    render(<HistoryPage />, { wrapper })

    // First page: 50 of 55 shown; the count is explicit so the seller knows more exist.
    await waitFor(() => expect(screen.getByText('Чек #1')).toBeInTheDocument())
    expect(screen.getByText(/Всего: 55 · показано 50/)).toBeInTheDocument()
    // A page-2 receipt is NOT yet in the DOM.
    expect(screen.queryByText('Чек #55')).toBeNull()

    // Load the remaining receipts.
    fireEvent.click(screen.getByRole('button', { name: /Загрузить ещё/ }))

    await waitFor(() => expect(screen.getByText('Чек #55')).toBeInTheDocument())
    expect(screen.getByText(/показано 55/)).toBeInTheDocument()
    // All 55 loaded → no more "Загрузить ещё".
    expect(screen.queryByRole('button', { name: /Загрузить ещё/ })).toBeNull()
  })
})
