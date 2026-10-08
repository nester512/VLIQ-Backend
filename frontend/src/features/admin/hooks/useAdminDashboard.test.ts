import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// Mock the API layer so we control page `items` vs server `total`.
const getAdminSellers = vi.fn()
const getAdminPayouts = vi.fn()
const getAdminReceipts = vi.fn()
vi.mock('@/api/admin', () => ({
  getAdminSellers: (...a: unknown[]) => getAdminSellers(...a),
  getAdminPayouts: (...a: unknown[]) => getAdminPayouts(...a),
  getAdminReceipts: (...a: unknown[]) => getAdminReceipts(...a),
}))

import { useAdminDashboard } from './useAdminDashboard'

const PAGE_LIMIT = 200

function fakeReceipts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    seller_id: 1000 + i,
    status: 'on_review',
    created_at: '2026-08-01T00:00:00Z',
    items: [],
    amount: 0,
  }))
}
function fakeSellers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    telegram_id: 1000 + i,
    id: 1000 + i,
    is_active: true,
    first_name: 'S',
    last_name: String(i),
    city: 'X',
  }))
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  getAdminSellers.mockReset()
  getAdminPayouts.mockReset()
  getAdminReceipts.mockReset()
})

describe('useAdminDashboard — count metrics use the server total, not the capped page', () => {
  it('reports receipts_loaded / sellers_total from server total even when the page caps at 200', async () => {
    // Pages return only 200 items, but the true totals are far larger.
    getAdminSellers.mockResolvedValue({ items: fakeSellers(PAGE_LIMIT), total: 500, page: 1, limit: 200 })
    getAdminPayouts.mockResolvedValue({ items: [], total: 0, page: 1, limit: 200 })
    getAdminReceipts.mockImplementation((args?: { status?: string[]; limit?: number }) => {
      // Pending probe (status filter) → server total of the review queue.
      if (args?.status) return Promise.resolve({ items: [], total: 291, page: 1, limit: 1 })
      // Full page (no status) → 200 items but a true total of 1361.
      return Promise.resolve({ items: fakeReceipts(PAGE_LIMIT), total: 1361, page: 1, limit: 200 })
    })

    const { result } = renderHook(() => useAdminDashboard(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())

    const d = result.current.data
    // The reported bug was 200 (page length) < 291 (pending). Now it is the real total.
    expect(d?.receipts_loaded).toBe(1361)
    expect(d?.receipts_pending).toBe(291)
    expect(d?.receipts_loaded).toBeGreaterThan(d?.receipts_pending ?? 0)
    expect(d?.sellers_total).toBe(500)
  })
})
