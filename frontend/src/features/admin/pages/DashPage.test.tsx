import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.stubGlobal('matchMedia', () => ({ matches: true }))

vi.mock('@/features/admin/hooks/useAdminDashboard', () => ({
  useAdminDashboard: () => ({
    isLoading: false,
    data: {
      sellers_total: 12,
      sellers_active: 9,
      receipts_loaded: 24,
      receipts_pending: 3,
      payouts_pending: 2,
      payouts_paid_month: 4,
      avg_check: 1_250,
      chart: { values: [1, 2, 3], max: 3, labels: ['1 июл', '15 июл', '30 июл'] },
      top_sellers: [],
    },
  }),
}))

vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: { openSheet: () => void }) => unknown) => selector({ openSheet: () => {} }),
}))

import { DashPage } from './DashPage'

afterEach(cleanup)

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}{location.search}</div>
}

function renderDashboard() {
  return render(
    <MemoryRouter initialEntries={['/admin/dash']}>
      <Routes>
        <Route path="/admin/dash" element={<DashPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('DashPage — metric drilldowns (KAN-31)', () => {
  it.each([
    ['Продавцов', '/admin/sellers'],
    ['Активных', '/admin/sellers?status=active'],
    ['Чеков загружено', '/admin/receipts'],
    ['На проверке', '/admin/review'],
    ['Средний чек', '/admin/receipts?status=approved'],
    ['Выплачено', '/admin/payouts?status=paid'],
  ])('opens the matching section from %s', (label, destination) => {
    renderDashboard()

    fireEvent.click(screen.getByRole('button', { name: new RegExp(label, 'i') }))

    expect(screen.getByTestId('location')).toHaveTextContent(destination)
  })
})
