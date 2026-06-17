import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Module mocks. These replace the real network / Telegram / store layers so
// the component renders deterministically under jsdom.
// ---------------------------------------------------------------------------

// City dictionary — three options, the test's source of truth.
const CITIES = [
  { id: 1, name: 'Москва' },
  { id: 2, name: 'Воронеж' },
  { id: 3, name: 'Екатеринбург' },
]
vi.mock('@/api/cities', () => ({
  getCities: vi.fn(() => Promise.resolve(CITIES)),
}))

// updateMe — the registration mutation. Per-test we tweak resolve/reject.
const updateMe = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
vi.mock('@/api/sellers', () => ({
  updateMe: (...args: unknown[]) => updateMe(...args),
}))

// Outside Telegram: no prefill, no "use Telegram phone" button.
vi.mock('@/utils/tma', () => ({
  isTmaEnvironment: () => false,
  getTgWebApp: () => undefined,
}))

const extractApiError = vi.fn<(...args: unknown[]) => unknown>(() => ({
  code: 'SELLER_PHONE_TAKEN',
  userMessage: 'Этот номер телефона уже зарегистрирован. Укажите другой.',
  debugId: '',
  status: 409,
}))
vi.mock('@/api/client', () => ({
  api: {},
  extractApiError: (...args: unknown[]) => extractApiError(...args),
}))

const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast }) => unknown) =>
    selector({ pushToast }),
}))

import { RegPage } from './RegPage'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<RegPage />, { wrapper: Wrapper })
}

function getCombobox(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement
}
function getPhoneInput(): HTMLInputElement {
  return screen.getByPlaceholderText('+7 ••• ••• •• ••') as HTMLInputElement
}

async function selectCity(user: ReturnType<typeof userEvent.setup>, name: string) {
  const combobox = getCombobox()
  await user.click(combobox)
  const option = await screen.findByRole('option', { name })
  await user.click(option)
}

/** Fill step 1 with valid data and advance to step 2. */
async function completeStep1(user: ReturnType<typeof userEvent.setup>, phone = '+79991234567') {
  await user.type(screen.getByLabelText('Имя'), 'Алексей')
  await user.type(screen.getByLabelText('Фамилия'), 'Морозов')
  await user.type(getPhoneInput(), phone)
  await user.tab() // blur phone → commits E.164
  await selectCity(user, 'Москва')
  const next = screen.getByRole('button', { name: 'Далее' })
  await waitFor(() => expect(next).toBeEnabled())
  await user.click(next)
  await screen.findByLabelText('Торговая точка')
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  updateMe.mockResolvedValue({})
})

// ---------------------------------------------------------------------------
// City combobox
// ---------------------------------------------------------------------------

describe('RegPage — city combobox', () => {
  it('city_renders_options: shows all cities when opened', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(getCombobox())
    expect(await screen.findByRole('option', { name: 'Москва' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Воронеж' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Екатеринбург' })).toBeInTheDocument()
  })

  it('city_filters: typing "Вор" leaves only Воронеж', async () => {
    const user = userEvent.setup()
    renderPage()
    const combobox = getCombobox()
    await user.click(combobox)
    await screen.findByRole('option', { name: 'Москва' })
    await user.type(combobox, 'Вор')
    const listbox = screen.getByRole('listbox')
    await waitFor(() => {
      expect(within(listbox).getAllByRole('option')).toHaveLength(1)
    })
    expect(within(listbox).getByRole('option', { name: 'Воронеж' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'Москва' })).toBeNull()
  })

  it('city_select_commits_name: clicking Москва puts the name in the input', async () => {
    const user = userEvent.setup()
    renderPage()
    await selectCity(user, 'Москва')
    expect(getCombobox().value).toBe('Москва')
  })

  it('city_free_text_rejected: free text is not committed, "Далее" stays disabled', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Имя'), 'Алексей')
    await user.type(screen.getByLabelText('Фамилия'), 'Морозов')
    await user.type(getPhoneInput(), '+79991234567')
    await user.tab()

    const combobox = getCombobox()
    await user.click(combobox)
    await screen.findByRole('option', { name: 'Москва' })
    await user.type(combobox, 'Лондон')
    await user.tab()

    await waitFor(() => expect(getCombobox().value).toBe(''))
    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Registration submit — no payout requisites in the анкета (S2.2)
// ---------------------------------------------------------------------------

describe('RegPage — submit', () => {
  it('reg_no_payout_fields: step 2 has no payout method/details inputs', async () => {
    const user = userEvent.setup()
    renderPage()
    await completeStep1(user)
    // The анкета must NOT collect payout requisites (entered per payout request).
    expect(screen.queryByRole('button', { name: 'Карта' })).toBeNull()
    expect(screen.queryByLabelText('Номер телефона для СБП')).toBeNull()
    expect(screen.queryByLabelText('Номер карты')).toBeNull()
  })

  it('reg_submit_without_payout: store name + consent is enough to finish', async () => {
    const user = userEvent.setup()
    renderPage()
    await completeStep1(user)
    await user.type(screen.getByLabelText('Торговая точка'), 'Дымов · ТЦ Авиапарк')
    await user.click(screen.getByRole('checkbox'))

    const submit = screen.getByRole('button', { name: 'Завершить регистрацию' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    await waitFor(() => expect(updateMe).toHaveBeenCalledTimes(1))
    const payload = updateMe.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('payout_method')
    expect(payload).not.toHaveProperty('payout_account_raw')
    expect(payload.store_name).toBe('Дымов · ТЦ Авиапарк')
  })

  it('error_toast_on_409: failed submit pushes a danger toast with the API message', async () => {
    const user = userEvent.setup()
    updateMe.mockRejectedValueOnce(new Error('409'))
    renderPage()
    await completeStep1(user)
    await user.type(screen.getByLabelText('Торговая точка'), 'Дымов · ТЦ Авиапарк')
    await user.click(screen.getByRole('checkbox'))

    const submit = screen.getByRole('button', { name: 'Завершить регистрацию' })
    await waitFor(() => expect(submit).toBeEnabled())
    await user.click(submit)

    await waitFor(() => {
      expect(pushToast).toHaveBeenCalledWith(
        'Этот номер телефона уже зарегистрирован. Укажите другой.',
        'dg',
      )
    })
  })
})
