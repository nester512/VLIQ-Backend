import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const requestPayout = vi.fn<(args: { payload: unknown; idempotencyKey: string }) => Promise<void>>(() => Promise.resolve())

vi.stubGlobal('matchMedia', () => ({ matches: true }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }))

vi.mock('../hooks/useBalance', () => ({
  useBalance: () => ({ data: { available: 500_000 }, isLoading: false }),
}))

vi.mock('../hooks/useRequestPayout', () => ({
  useRequestPayout: () => ({ mutateAsync: requestPayout, isPending: false }),
}))

// UC-S7: a few banks of the NSPK list, popular first (the server's order).
vi.mock('../hooks/useSbpBanks', () => ({
  useSbpBanks: () => ({
    isLoading: false,
    data: [
      { id: '100000000111', name: 'Сбербанк', popular: true },
      { id: '100000000004', name: 'Т-Банк', popular: true },
      { id: '100000000008', name: 'АЛЬФА-БАНК', popular: true },
      { id: '100000000025', name: 'МОСКОВСКИЙ КРЕДИТНЫЙ БАНК', popular: false },
      { id: '100000000183', name: 'КБ Пойдём!', popular: false },
    ],
  }),
}))

import { PayoutPage } from './PayoutPage'

/** Open «Банк получателя», optionally search, and pick a bank from the list. */
async function chooseBank(user: ReturnType<typeof userEvent.setup>, name = 'Сбербанк', search?: string) {
  await user.click(screen.getByTestId('bank-picker'))
  if (search) await user.type(await screen.findByLabelText(/Название банка: сбер/), search)
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }))
}

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
    await chooseBank(user)

    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeEnabled()
    expect(screen.getByText('Выплата будет произведена в течение 7 рабочих дней.')).toBeInTheDocument()
  })

  it('rejects a landline / short number — SBP needs a mobile', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+7 495 123-45-67')
    await chooseBank(user)

    expect(screen.getByText('Номер мобильного: +7 9XX XXX-XX-XX')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeDisabled()
  })

  it('sends the normalised phone and keeps one idempotency key for retries of the same form', async () => {
    const user = userEvent.setup()
    requestPayout.mockRejectedValueOnce(new Error('network'))
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '8 (999) 123-45-67')
    await chooseBank(user)
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))

    expect(requestPayout).toHaveBeenCalledTimes(2)
    const [first, second] = requestPayout.mock.calls
    expect(first![0].payload).toEqual({ amount: 300_000, method: 'sbp_phone', phone: '+79991234567', bankId: '100000000111' })
    expect(second![0].idempotencyKey).toBe(first![0].idempotencyKey)
  })

  it('a changed amount is a new request — a new key', async () => {
    const user = userEvent.setup()
    requestPayout.mockReset()
    requestPayout.mockRejectedValueOnce(new Error('network'))
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+79991234567')
    await chooseBank(user)
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))
    await user.clear(screen.getByLabelText('Сумма выплаты, ₽'))
    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3500')
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))

    const [first, second] = requestPayout.mock.calls
    expect(second![0].idempotencyKey).not.toBe(first![0].idempotencyKey)
  })
})

describe('PayoutPage — after sending', () => {
  it('«Мои заявки» replaces the form: «назад» does not return into the sent request', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+79991234567')
    await chooseBank(user)
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))
    expect(navigate).toHaveBeenCalledWith('/seller/payouts', { replace: true })
  })

  it('«Банк получателя» is required: phone alone does not enable the request', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+79991234567')
    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeDisabled()

    await chooseBank(user, 'Т-Банк', 'тинькофф')
    expect(screen.getByTestId('bank-picker')).toHaveTextContent('Т-Банк')
    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeEnabled()
  })

  it('a bank missing from the list: the typed name becomes «Другое» in one tap', async () => {
    const user = userEvent.setup()
    requestPayout.mockReset()
    requestPayout.mockResolvedValue(undefined)
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+79991234567')
    await user.click(screen.getByTestId('bank-picker'))
    await user.type(await screen.findByLabelText(/Название банка: сбер/), 'Росбанк')
    expect(await screen.findByTestId('bank-not-found')).toHaveTextContent('«Росбанк» нет в списке банков СБП')
    await user.click(screen.getByRole('button', { name: /Указать «Росбанк»/ }))

    expect(screen.getByLabelText('Название банка')).toHaveValue('Росбанк')
    await user.click(screen.getByRole('button', { name: /^Запросить/ }))
    expect(requestPayout.mock.calls[0]![0].payload).toEqual({
      amount: 300_000, method: 'sbp_phone', phone: '+79991234567', bankId: 'other', bankName: 'Росбанк',
    })
  })

  it('«Другое» without a name keeps the request disabled', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Сумма выплаты, ₽'), '3000')
    await user.type(screen.getByLabelText('Номер телефона для СБП'), '+79991234567')
    await user.click(screen.getByTestId('bank-picker'))
    await user.click(await screen.findByTestId('bank-other'))

    expect(screen.getByLabelText('Название банка')).toHaveValue('')
    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeDisabled()
    await user.type(screen.getByLabelText('Название банка'), 'Хоум Банк')
    expect(screen.getByRole('button', { name: /^Запросить/ })).toBeEnabled()
  })
})
