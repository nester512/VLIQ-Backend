import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const requestPayout = vi.fn(() => Promise.resolve())

vi.stubGlobal('matchMedia', () => ({ matches: true }))

vi.mock('../hooks/useBalance', () => ({
  useBalance: () => ({ data: { available: 500_000 }, isLoading: false }),
}))

vi.mock('../hooks/useRequestPayout', () => ({
  useRequestPayout: () => ({ mutateAsync: requestPayout, isPending: false }),
}))

import { PayoutPage } from './PayoutPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <PayoutPage />
    </MemoryRouter>,
  )
}

describe('PayoutPage', () => {
  it('does not allow a payout below 3,000 ₽', async () => {
    const user = userEvent.setup()
    renderPage()

    const amount = screen.getByLabelText('Сумма выплаты, ₽')
    await user.type(amount, '2999')

    expect(screen.getByText('Минимальная сумма — 3 000 ₽')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeDisabled()
  })

  it('allows 3,000 ₽ after valid payout details are entered', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+79991234567')

    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeEnabled()
    expect(screen.getByText('Выплата будет произведена в течение 7 рабочих дней.')).toBeInTheDocument()
  })
})
