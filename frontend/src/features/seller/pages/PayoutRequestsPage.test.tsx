import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { PayoutRequest } from '@/types/models'

const base: PayoutRequest = {
  id: '1', seller_id: 1, amount: 300_000, method: 'sbp_phone', details: '+79991234567', status: 'new',
  created_at: '2026-10-09T10:00:00Z',
}
vi.mock('@/api/payouts', () => ({
  getMyPayoutRequests: () =>
    Promise.resolve([
      { ...base, id: '3', status: 'rejected', admin_comment: 'Номер не подключён к СБП', rejected_at: '2026-10-09T12:00:00Z' },
      { ...base, id: '2', status: 'paid', paid_at: '2026-10-09T11:00:00Z' },
      { ...base, id: '1', status: 'in_progress' },
    ]),
}))

import { PayoutRequestsPage } from './PayoutRequestsPage'

describe('PayoutRequestsPage — «Мои заявки на выплату»', () => {
  it('shows statuses and the rejection reason to the seller', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><PayoutRequestsPage /></MemoryRouter>
      </QueryClientProvider>,
    )
    const [rejected, paid, inProgress] = await screen.findAllByTestId('payout-request')
    expect(within(rejected!).getByText('Отклонена')).toBeInTheDocument()
    expect(rejected).toHaveTextContent('Причина: Номер не подключён к СБП. Сумма вернулась на баланс.')
    expect(within(paid!).getByText('Выплачена')).toBeInTheDocument()
    expect(paid).toHaveTextContent('выплачена')
    expect(within(inProgress!).getByText('В обработке')).toBeInTheDocument()
    expect(inProgress).not.toHaveTextContent('Причина')
  })
})
