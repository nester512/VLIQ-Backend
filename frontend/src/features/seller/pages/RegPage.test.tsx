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
// Typed with a rest signature so the forwarding wrapper below can spread args.
const updateMe = vi.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
vi.mock('@/api/sellers', () => ({
  updateMe: (...args: unknown[]) => updateMe(...args),
}))

// Outside Telegram: no prefill, no "use Telegram phone" button.
vi.mock('@/utils/tma', () => ({
  isTmaEnvironment: () => false,
  getTgWebApp: () => undefined,
}))

// api is unused (cities/sellers are mocked); extractApiError is driven for the
// toast test.
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

// uiStore — pushToast is a shared spy so we can assert on (message, kind).
const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast }) => unknown) =>
    selector({ pushToast }),
}))

// Import under test AFTER the mocks are registered.
import { RegPage } from './RegPage'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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

/** Open the combobox and click the option with the given city name. */
async function selectCity(user: ReturnType<typeof userEvent.setup>, name: string) {
  const combobox = getCombobox()
  await user.click(combobox)
  // Options live until the dictionary resolves; wait for it.
  const option = await screen.findByRole('option', { name })
  await user.click(option)
}

/** Fill step 1 with valid data and advance to step 2. */
async function completeStep1(user: ReturnType<typeof userEvent.setup>, phone = '+79991234567') {
  await user.type(screen.getByLabelText('Имя'), 'Алексей')
  await user.type(screen.getByLabelText('Фамилия'), 'Морозов')
  const phoneInput = getPhoneInput()
  await user.type(phoneInput, phone)
  await user.tab() // blur phone → commits E.164
  await selectCity(user, 'Москва')
  const next = screen.getByRole('button', { name: 'Далее' })
  await waitFor(() => expect(next).toBeEnabled())
  await user.click(next)
  // Step 2 is shown once the store-name field appears.
  await screen.findByLabelText('Торговая точка')
}

beforeEach(() => {
  vi.clearAllMocks()
  cleanup()
  // updateMe defaults to resolve; the 409 test overrides it.
  updateMe.mockResolvedValue({})
})

// ---------------------------------------------------------------------------
// City combobox (пункт 1)
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
    // Fill everything else on step 1 so only the city can keep the button disabled.
    await user.type(screen.getByLabelText('Имя'), 'Алексей')
    await user.type(screen.getByLabelText('Фамилия'), 'Морозов')
    const phoneInput = getPhoneInput()
    await user.type(phoneInput, '+79991234567')
    await user.tab()

    const combobox = getCombobox()
    await user.click(combobox)
    await screen.findByRole('option', { name: 'Москва' })
    await user.type(combobox, 'Лондон')
    // Blur without selecting an option — moves focus away from the combobox.
    await user.tab()

    // Free text was dropped: the committed display is empty (not "Лондон").
    await waitFor(() => expect(getCombobox().value).toBe(''))
    // And the step is not advanceable.
    expect(screen.getByRole('button', { name: 'Далее' })).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Payout method switching + validation (пункт 2)
// ---------------------------------------------------------------------------

describe('RegPage — payout method', () => {
  it('payout_switch_clears_details: switching method empties the details field', async () => {
    const user = userEvent.setup()
    renderPage()
    await completeStep1(user)

    await user.click(screen.getByRole('button', { name: 'СБП' }))
    const sbpField = screen.getByLabelText('Номер телефона для СБП') as HTMLInputElement
    await user.clear(sbpField)
    await user.type(sbpField, '+79995554433')
    expect(sbpField.value).toBe('+79995554433')

    await user.click(screen.getByRole('button', { name: 'Карта' }))
    // The details field (now labelled "Номер карты") must be empty.
    const cardField = screen.getByLabelText('Номер карты') as HTMLInputElement
    expect(cardField.value).toBe('')
  })

  it('payout_reclick_noop: re-clicking the same method keeps the value', async () => {
    const user = userEvent.setup()
    renderPage()
    await completeStep1(user)

    await user.click(screen.getByRole('button', { name: 'Карта' }))
    const cardField = screen.getByLabelText('Номер карты') as HTMLInputElement
    await user.type(cardField, '4111111111111111')
    expect(cardField.value).toBe('4111111111111111')

    // Clicking the already-selected method must NOT clear the value.
    await user.click(screen.getByRole('button', { name: 'Карта' }))
    expect((screen.getByLabelText('Номер карты') as HTMLInputElement).value).toBe('4111111111111111')
  })

  it('payout_card_format: bad card shows error, fixing it clears the error', async () => {
    const user = userEvent.setup()
    renderPage()
    await completeStep1(user)

    await user.click(screen.getByRole('button', { name: 'Карта' }))
    const cardField = screen.getByLabelText('Номер карты') as HTMLInputElement
    await user.type(cardField, '123')
    await user.tab() // blur → touched

    expect(await screen.findByText('Введите номер карты (16–19 цифр)')).toBeInTheDocument()

    await user.clear(cardField)
    await user.type(cardField, '4111111111111111')
    await waitFor(() => {
      expect(screen.queryByText('Введите номер карты (16–19 цифр)')).toBeNull()
    })
  })

  it('payout_sbp_autofill: selecting СБП prefills details with the phone', async () => {
    const user = userEvent.setup()
    renderPage()
    await completeStep1(user, '+79991234567')

    await user.click(screen.getByRole('button', { name: 'СБП' }))
    const sbpField = screen.getByLabelText('Номер телефона для СБП') as HTMLInputElement
    expect(sbpField.value).toBe('+79991234567')
  })
})

// ---------------------------------------------------------------------------
// Error toast on 409 (пункт 3)
// ---------------------------------------------------------------------------

describe('RegPage — error toast', () => {
  it('error_toast_on_409: failed submit pushes a danger toast with the API message', async () => {
    const user = userEvent.setup()
    updateMe.mockRejectedValueOnce(new Error('409'))
    renderPage()
    await completeStep1(user)

    // Fill the rest of step 2 validly.
    await user.type(screen.getByLabelText('Торговая точка'), 'Дымов · ТЦ Авиапарк')
    await user.click(screen.getByRole('button', { name: 'СБП' }))
    // СБП autofilled the details from the phone; that value is valid.
    expect((screen.getByLabelText('Номер телефона для СБП') as HTMLInputElement).value).toBe('+79991234567')

    // Consent checkbox.
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
