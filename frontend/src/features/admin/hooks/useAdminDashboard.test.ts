import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import type { AdminDashboardResponse } from '@/api/admin'

const getAdminDashboard = vi.fn()
const getAdminSellers = vi.fn()
const getAdminReceipts = vi.fn()
const getAdminPayouts = vi.fn()
vi.mock('@/api/admin', () => ({
  getAdminDashboard: (...a: unknown[]) => getAdminDashboard(...a),
  getAdminSellers: (...a: unknown[]) => getAdminSellers(...a),
  getAdminReceipts: (...a: unknown[]) => getAdminReceipts(...a),
  getAdminPayouts: (...a: unknown[]) => getAdminPayouts(...a),
}))

import { toDashboardData, useAdminDashboard } from './useAdminDashboard'

function dto(overrides: Partial<AdminDashboardResponse> = {}): AdminDashboardResponse {
  const days = Array.from({ length: 30 }, (_, i) => ({
    day: `2026-09-${String(i + 1).padStart(2, '0')}`,
    receipts: i === 29 ? 120 : i,
  }))
  return {
    sellers_total: 2008,
    sellers_active: 1861,
    receipts_total: 75292,
    receipts_on_review: 7322,
    payouts_pending: 344,
    payouts_pending_amount: 39_090_359,
    payouts_paid_month: 232,
    payouts_paid_month_amount: 21_771_506,
    avg_check: 265_731,
    daily_receipts: days,
    top_sellers: [
      { telegram_id: 7, name: 'Анна', city: null, receipts_total: 90, receipts_approved: 80, sales: 1_000_000, paid: 50_000 },
      { telegram_id: 8, name: 'Борис', city: 'Казань', receipts_total: 5, receipts_approved: 0, sales: 0, paid: 0 },
    ],
    top_products: [{ name: 'SWONQ L18000', count: 11 }],
    generated_at: '2026-10-08T20:00:00Z',
    ...overrides,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return createElement(QueryClientProvider, { client: qc }, children)
}

beforeEach(() => {
  getAdminDashboard.mockReset()
  getAdminSellers.mockReset()
  getAdminReceipts.mockReset()
  getAdminPayouts.mockReset()
})

describe('useAdminDashboard — metrics come from the server aggregate', () => {
  it('makes exactly one dashboard call and never samples the list endpoints', async () => {
    getAdminDashboard.mockResolvedValue(dto())

    const { result } = renderHook(() => useAdminDashboard(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(getAdminDashboard).toHaveBeenCalledTimes(1)
    expect(getAdminSellers).not.toHaveBeenCalled()
    expect(getAdminReceipts).not.toHaveBeenCalled()
    expect(getAdminPayouts).not.toHaveBeenCalled()

    const d = result.current.data!
    expect(d.sellers_total).toBe(2008)
    expect(d.sellers_active).toBe(1861)
    expect(d.receipts_loaded).toBe(75292)
    expect(d.receipts_pending).toBe(7322)
    expect(d.payouts_pending).toBe(344)
    expect(d.payouts_paid_month).toBe(232)
    expect(d.avg_check).toBe(265_731)
  })
})

describe('toDashboardData', () => {
  it('turns the 30-day series into the chart, scaled to the busiest day', () => {
    const d = toDashboardData(dto())
    expect(d.chart.values).toHaveLength(30)
    expect(d.chart.values[29]).toBe(120)
    expect(d.chart.max).toBe(120)
    expect(d.chart.labels[0]).toMatch(/1 сент/)
    expect(d.chart.labels[2]).toMatch(/30 сент/)
  })

  it('keeps an empty chart safe (max ≥ 1, dash labels)', () => {
    const d = toDashboardData(dto({ daily_receipts: [] }))
    expect(d.chart.max).toBe(1)
    expect(d.chart.labels).toEqual(['—', '—', '—'])
  })

  it('maps top sellers with approved/total label and city fallback', () => {
    const [first, second] = toDashboardData(dto()).top_sellers
    expect(first).toEqual({ telegram_id: 7, name: 'Анна', city: '—', receipts: '80 одобрено', sales: 1_000_000, paid: 50_000, accrued: 0 })
    expect(second!.receipts).toBe('5 чеков')
    expect(second!.city).toBe('Казань')
  })
})
