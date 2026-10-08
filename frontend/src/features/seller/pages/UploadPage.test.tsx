import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import type { ReactNode } from 'react'

// QR intake page: the device validates and shows the data back; ONE JSON request
// is sent only after the seller confirms. Bad scans never reach the API.

vi.mock('@/api/sellers', () => ({ getMe: vi.fn(() => Promise.resolve({ brand_id: 3 })) }))

const submitQrReceipt = vi.fn()
vi.mock('@/api/receipts', () => ({ submitQrReceipt: (...a: unknown[]) => submitQrReceipt(...a) }))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast }),
}))

import { UploadPage } from './UploadPage'

const FN = '9960440300712345'
const today = () => {
  const msk = new Date(Date.now() + 3 * 3600_000 - 3600_000) // 1 h ago, MSK
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    t: `${msk.getUTCFullYear()}${p(msk.getUTCMonth() + 1)}${p(msk.getUTCDate())}T${p(msk.getUTCHours())}${p(msk.getUTCMinutes())}`,
    date: `${msk.getUTCFullYear()}-${p(msk.getUTCMonth() + 1)}-${p(msk.getUTCDate())}`,
    time: `${p(msk.getUTCHours())}:${p(msk.getUTCMinutes())}`,
  }
}
const goodQr = () => `t=${today().t}&s=1450.00&fn=${FN}&i=12345&fp=3826178549&n=1`

type ScanCb = (data: string) => boolean | void
let scanCb: ScanCb | null = null
const closeScanQrPopup = vi.fn()

function installTelegram() {
  ;(window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      showScanQrPopup: (_p: unknown, cb: ScanCb) => { scanCb = cb },
      closeScanQrPopup,
    },
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<UploadPage />, { wrapper: Wrapper })
}

function apiError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders(), url: '/receipts/qr' } as InternalAxiosRequestConfig
  return new AxiosError('fail', undefined, config, {}, { status, statusText: '', data, headers: {}, config } as AxiosResponse)
}

beforeEach(() => {
  submitQrReceipt.mockReset()
  submitQrReceipt.mockResolvedValue({ id: '42', warnings: [] })
  navigate.mockReset()
  pushToast.mockReset()
  closeScanQrPopup.mockReset()
  scanCb = null
  try { localStorage.clear() } catch { /* jsdom */ }
})
afterEach(() => {
  cleanup()
  delete (window as unknown as { Telegram?: unknown }).Telegram
})

describe('UploadPage — scan with the Telegram scanner', () => {
  it('a non-receipt QR keeps the scanner open and sends nothing', async () => {
    installTelegram()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))

    expect(scanCb!('https://vliq.ru/promo')).toBe(false)
    expect(closeScanQrPopup).not.toHaveBeenCalled()
    expect(await screen.findByText(/Это не QR-код кассового чека/)).toBeInTheDocument()
    expect(submitQrReceipt).not.toHaveBeenCalled()
  })

  it('a refund QR is rejected on the device', async () => {
    installTelegram()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))

    expect(scanCb!(goodQr().replace('n=1', 'n=2'))).toBe(false)
    expect(await screen.findByText(/Это не чек продажи/)).toBeInTheDocument()
  })

  it('a valid QR → confirmation card; sending needs the explicit confirmation', async () => {
    installTelegram()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))
    expect(scanCb!(goodQr())).toBe(true)
    expect(closeScanQrPopup).toHaveBeenCalled()

    expect(await screen.findByText('Проверьте данные чека')).toBeInTheDocument()
    expect(screen.getByText(FN)).toBeInTheDocument()
    expect(screen.getByText('Источник: Сканер Telegram')).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Отправить на проверку' })
    expect(send).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(send)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/seller/status/42'))
    expect(submitQrReceipt).toHaveBeenCalledTimes(1)
    const payload = submitQrReceipt.mock.calls[0]![0]
    expect(payload).toMatchObject({
      brand_id: 3, source: 'telegram_scan', fn: FN, fd: '12345', fp: '3826178549', t: today().t, s: '1450.00', n: 1,
    })
    expect(payload.idempotency_key).toMatch(new RegExp(`:${FN}:12345:3826178549$`))
    expect(payload).not.toHaveProperty('files')
  })

  it('warns when the same receipt was already sent from this device', async () => {
    installTelegram()
    const first = renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))
    scanCb!(goodQr())
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на проверку' }))
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    first.unmount()

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))
    scanCb!(goodQr())
    expect(await screen.findByText(/Вы уже отправляли этот чек/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить повторно' })).toBeInTheDocument()
  })
})

describe('UploadPage — manual entry', () => {
  function fill(values: Partial<Record<'Дата' | 'Время' | 'Сумма' | 'ФН' | 'ФД' | 'ФП', string>>) {
    for (const [label, value] of Object.entries(values)) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } })
    }
  }

  it('validates on the device, then confirms and sends source=manual', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Ввести вручную/ }))
    const { date, time } = today()

    fill({ Дата: date, Время: time, Сумма: '99,90', ФН: '123', ФД: '7', ФП: '1' })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    expect(await screen.findByText('ФН — ровно 16 цифр')).toBeInTheDocument()

    fill({ ФН: '9960 4403 0071 2345' })
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    expect(await screen.findByText('Источник: Ручной ввод')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на проверку' }))
    await waitFor(() => expect(submitQrReceipt).toHaveBeenCalled())
    expect(submitQrReceipt.mock.calls[0]![0]).toMatchObject({ source: 'manual', fn: FN, s: '99.90' })
  })

  it('empty fields are reported without a request', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Ввести вручную/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Проверить' }))
    expect((await screen.findAllByText('Заполните поле')).length).toBe(6)
    expect(submitQrReceipt).not.toHaveBeenCalled()
  })

  it('a server 422 on a field brings the seller back to the form with that field marked', async () => {
    installTelegram()
    submitQrReceipt.mockRejectedValueOnce(
      apiError(422, { code: 'QR_FP_INVALID', user_message: 'ФП — число до 10 цифр', debug_id: 'x', extra: { field: 'fp' } }),
    )
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Сканировать QR-код/ }))
    scanCb!(goodQr())
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Отправить на проверку' }))

    expect(await screen.findByLabelText('ФП')).toHaveValue('3826178549') // prefilled form
    expect(screen.getAllByText('ФП — число до 10 цифр').length).toBeGreaterThan(0)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('UploadPage — outside the Telegram app', () => {
  it('without any scanner, offers manual entry and explains why', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /Сканировать QR-код/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Сканер QR доступен в мобильном приложении Telegram/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ввести вручную/ })).toBeInTheDocument()
  })
})
