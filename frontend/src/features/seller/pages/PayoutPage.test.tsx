import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const requestPayout = vi.fn<(args: { payload: unknown; idempotencyKey: string }) => Promise<void>>(() => Promise.resolve())

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

  it('rejects a landline / short number — SBP needs a mobile', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+7 495 123-45-67')

    expect(screen.getByText('Номер мобильного: +7 9XX XXX-XX-XX')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeDisabled()
  })

  it('sends the normalised phone and keeps one idempotency key for retries of the same form', async () => {
    const user = userEvent.setup()
    requestPayout.mockRejectedValueOnce(new Error('network'))
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '8 (999) 123-45-67')
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))

    expect(requestPayout).toHaveBeenCalledTimes(2)
    const [first, second] = requestPayout.mock.calls
    expect(first![0].payload).toEqual({ amount: 300_000, method: 'sbp_phone', phone: '+79991234567' })
    expect(second![0].idempotencyKey).toBe(first![0].idempotencyKey)
  })
})
