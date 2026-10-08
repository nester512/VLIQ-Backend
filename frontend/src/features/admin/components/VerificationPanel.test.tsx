import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReceiptVerification } from '@/api/admin'

const { getReceiptVerification, verifyReceiptNow, pushToast } = vi.hoisted(() => ({
  getReceiptVerification: vi.fn(),
  verifyReceiptNow: vi.fn(),
  pushToast: vi.fn(),
}))
vi.mock('@/api/admin', () => ({ getReceiptVerification, verifyReceiptNow }))
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: object) => unknown) => selector({ pushToast }),
}))

import { VerificationPanel } from './VerificationPanel'

const attempt = (n: number, outcome: 'ok' | 'not_found', trigger: 'pipeline' | 'cron' | 'admin', method = 'fields') => ({
  attempt_no: n, provider: 'proverkacheka', method, trigger, outcome, http_status: 200,
  request: { fn: '9960440300712345' }, response: { code: outcome === 'ok' ? 1 : 2 }, error: null, duration_ms: 120,
  created_at: '2026-10-08T12:00:00Z',
})

function state(over: Partial<ReceiptVerification> = {}): ReceiptVerification {
  return {
    receipt_id: 7, source: 'telegram_scan', status: 'retrying', attempts_count: 2,
    next_attempt_at: '2026-10-08T13:00:00Z', verified_at: null, ofd_response: null,
    attempts: [attempt(2, 'not_found', 'cron', 'qrraw'), attempt(1, 'not_found', 'pipeline')],
    ...over,
  }
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <VerificationPanel receiptId="7" />
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('VerificationPanel', () => {
  it('shows the state, the schedule and every attempt newest first', async () => {
    getReceiptVerification.mockResolvedValue(state())
    renderPanel()

    expect(await screen.findByText('ОФД: повтор по расписанию')).toBeInTheDocument()
    expect(screen.getByText('Источник данных: QR · сканер Telegram')).toBeInTheDocument()
    expect(screen.getByText(/Следующая попытка/)).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('№2 · нет данных')
    expect(items[0]).toHaveTextContent('по расписанию · по строке QR')
    expect(items[1]).toHaveTextContent('при загрузке · по реквизитам')
  })

  it('reveals the raw request/response of an attempt on demand', async () => {
    getReceiptVerification.mockResolvedValue(state())
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: /№2/ }))
    expect(screen.getByText(/"code": 2/)).toBeInTheDocument()
  })

  it('«Проверить сейчас» runs an attempt and shows the fresh history', async () => {
    getReceiptVerification.mockResolvedValue(state())
    verifyReceiptNow.mockResolvedValue(
      state({ status: 'verified', attempts_count: 3, verified_at: '2026-10-08T12:05:00Z',
              attempts: [attempt(3, 'ok', 'admin'), ...state().attempts] }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить сейчас' }))

    await waitFor(() => expect(screen.getByText('Подтверждён в ОФД')).toBeInTheDocument())
    expect(verifyReceiptNow).toHaveBeenCalledWith('7')
    expect(pushToast).toHaveBeenCalledWith('Чек найден в ОФД', 'ok')
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('№3 · найден')
  })

  it('tells the admin to check by hand once retries are exhausted', async () => {
    getReceiptVerification.mockResolvedValue(state({ status: 'failed', next_attempt_at: null }))
    renderPanel()
    expect(await screen.findByText(/Автоматические попытки исчерпаны/)).toBeInTheDocument()
  })

  it('renders nothing for legacy receipts', async () => {
    getReceiptVerification.mockResolvedValue(state({ status: 'not_required', attempts: [], source: null }))
    const { container } = renderPanel()
    await waitFor(() => expect(getReceiptVerification).toHaveBeenCalled())
    await waitFor(() => expect(container.querySelector('[data-testid="verification-panel"]')).toBeNull())
  })
})
