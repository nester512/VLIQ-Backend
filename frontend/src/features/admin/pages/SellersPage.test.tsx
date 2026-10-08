import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { AdminSellerRow, SellerStats } from '@/api/admin'

const { getAdminSellers } = vi.hoisted(() => ({ getAdminSellers: vi.fn() }))
vi.mock('@/api/admin', () => ({ getAdminSellers }))

import { SellersPage } from './SellersPage'

function stats(overrides: Partial<SellerStats> = {}): SellerStats {
  return {
    receipts_total: 0,
    receipts_approved: 0,
    receipts_rejected: 0,
    receipts_on_review: 0,
    receipts_30d: 0,
    receipts_duplicates: 0,
    first_receipt_at: null,
    last_receipt_at: null,
    risk_score: 0,
    risk_level: 'low',
    risk_flags: [],
    ...overrides,
  }
}

function seller(id: number, s: Partial<SellerStats> = {}): AdminSellerRow {
  return {
    id,
    telegram_id: id,
    first_name: `Продавец`,
    last_name: String(id),
    city: 'Москва',
    store_name: `Точка ${id}`,
    is_active: true,
    status: 'active',
    stats: stats(s),
  }
}

function page(items: AdminSellerRow[], p: number, total: number) {
  return { items, total, page: p, limit: 50, has_more: p * 50 < total }
}

afterEach(() => {
  cleanup()
  getAdminSellers.mockReset()
})

function renderPage(entry = '/admin/sellers') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin/sellers" element={<SellersPage />} />
          <Route path="/admin/sellers/:telegramId/receipts" element={<div>seller page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SellersPage — server-side search, filters, sorts and infinite scroll', () => {
  it('shows the server total, receipt count, 30-day frequency and the risk pill', async () => {
    getAdminSellers.mockResolvedValue(
      page([seller(1, { receipts_total: 42, receipts_30d: 7, risk_level: 'high', risk_score: 60, receipts_on_review: 2 })], 1, 2014),
    )
    renderPage()

    expect(await screen.findByText('Продавец 1')).toBeInTheDocument()
    expect(screen.getByTestId('sellers-total')).toHaveTextContent('Найдено: 2 014')
    expect(screen.getByText('42 чека · 7 за 30 дн.')).toBeInTheDocument()
    expect(screen.getByText('Высокий риск')).toBeInTheDocument()
    expect(screen.getByText('2 на проверке')).toBeInTheDocument()
    expect(getAdminSellers).toHaveBeenCalledWith({
      search: undefined, status: undefined, risk: undefined, has_on_review: undefined,
      sort: 'created_at:desc', page: 1, limit: 50,
    })
  })

  it('restores filters from the URL and sends them to the API', async () => {
    getAdminSellers.mockResolvedValue(page([], 1, 0))
    renderPage('/admin/sellers?status=blocked&risk=high&sort=receipts_30d:desc&review=1&q=Анна')

    await waitFor(() =>
      expect(getAdminSellers).toHaveBeenCalledWith({
        search: 'Анна', status: 'blocked', risk: 'high', has_on_review: true,
        sort: 'receipts_30d:desc', page: 1, limit: 50,
      }),
    )
    expect(await screen.findByText('Ничего не нашли')).toBeInTheDocument()
  })

  it('changes sort and filters from the controls', async () => {
    getAdminSellers.mockResolvedValue(page([seller(1)], 1, 1))
    renderPage()
    await screen.findByText('Продавец 1')

    fireEvent.change(screen.getByLabelText('Сортировка'), { target: { value: 'receipts_total:desc' } })
    await waitFor(() => expect(getAdminSellers).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'receipts_total:desc' })))

    fireEvent.click(screen.getByRole('button', { name: 'Средний' }))
    await waitFor(() => expect(getAdminSellers).toHaveBeenLastCalledWith(expect.objectContaining({ risk: 'medium' })))

    fireEvent.click(screen.getByRole('button', { name: 'Ожидают' }))
    await waitFor(() => expect(getAdminSellers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'pending' })))
  })

  it('debounces the search before hitting the API', async () => {
    getAdminSellers.mockResolvedValue(page([seller(1)], 1, 1))
    renderPage()
    await screen.findByText('Продавец 1')
    const calls = getAdminSellers.mock.calls.length

    fireEvent.change(screen.getByPlaceholderText(/Имя, телефон/), { target: { value: '7900' } })
    expect(getAdminSellers.mock.calls.length).toBe(calls) // not on every keystroke

    await waitFor(() => expect(getAdminSellers).toHaveBeenLastCalledWith(expect.objectContaining({ search: '7900' })))
  })

  it('loads the next page and appends it (beyond the first 50)', async () => {
    const first = Array.from({ length: 50 }, (_, i) => seller(i + 1))
    getAdminSellers.mockImplementation(({ page: p }: { page: number }) =>
      Promise.resolve(p === 1 ? page(first, 1, 51) : page([seller(51)], 2, 51)),
    )
    renderPage()
    await screen.findByText('Продавец 50')
    expect(screen.getByTestId('sellers-total')).toHaveTextContent('показано 50')

    fireEvent.click(screen.getByRole('button', { name: 'Загрузить ещё' }))

    expect(await screen.findByText('Продавец 51')).toBeInTheDocument()
    expect(getAdminSellers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    expect(screen.queryByRole('button', { name: 'Загрузить ещё' })).not.toBeInTheDocument()
  })

  it('opens the seller page on row click', async () => {
    getAdminSellers.mockResolvedValue(page([seller(777)], 1, 1))
    renderPage()

    fireEvent.click(await screen.findByText('Продавец 777'))

    expect(await screen.findByText('seller page')).toBeInTheDocument()
  })
})
