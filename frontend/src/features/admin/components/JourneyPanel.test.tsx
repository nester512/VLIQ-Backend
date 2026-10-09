import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CheckProvider, JourneyEvent, ReceiptCheck, ReceiptJourney } from '@/api/admin'

const { getReceiptJourney, verifyReceiptNow, pushToast } = vi.hoisted(() => ({
  getReceiptJourney: vi.fn(),
  verifyReceiptNow: vi.fn(),
  pushToast: vi.fn(),
}))
vi.mock('@/api/admin', () => ({ getReceiptJourney, verifyReceiptNow }))
vi.mock('@/store/uiStore', () => ({ useUiStore: (sel: (s: object) => unknown) => sel({ pushToast }) }))

import { JourneyPanel } from './JourneyPanel'

const AT = '2026-10-09T10:00:00Z'
const check = (over: Partial<ReceiptCheck> = {}): ReceiptCheck => ({
  id: 1, attempt_no: 1, round_no: 1, provider: 'proverkacheka', provider_role: 'main', adapter_version: '1',
  method: 'fields', trigger: 'pipeline', outcome: 'not_found', http_status: 200,
  request: { fn: '9960440300712345', fd: '12345' }, response: { code: 2 }, parsed: null, error: null,
  duration_ms: 120, created_at: AT, ...over,
})
let seq = 0
const ev = (kind: string, over: Partial<JourneyEvent> = {}): JourneyEvent => ({
  seq: ++seq, at: AT, kind, actor_type: 'system', actor_id: null, source: null, outcome: null, data: null, check: null, ...over,
})
const providers: CheckProvider[] = [
  { code: 'fns', title: 'ФНС', role: 'main', priority: 10, enabled: true, available: false, disabled_until: null, consecutive_failures: 0 },
  { code: 'proverkacheka', title: 'pc', role: 'main', priority: 20, enabled: true, available: true, disabled_until: null, consecutive_failures: 0 },
  { code: 'platformaofd', title: 'П', role: 'fallback', priority: 30, enabled: false, available: false, disabled_until: null, consecutive_failures: 0 },
]

function journey(over: Partial<ReceiptJourney['summary']> = {}, events?: JourneyEvent[]): ReceiptJourney {
  seq = 0
  return {
    receipt_id: 7,
    summary: {
      received_at: AT, intake_source: 'telegram_scan', status: 'on_review', verification_status: 'retrying',
      verified_by: null, verified_at: null, check_rounds: 1, next_check_at: '2026-10-09T10:05:00Z',
      decision: null, decided_at: null, decided_by: null, ...over,
    },
    events: events ?? [
      ev('received', { actor_type: 'seller', actor_id: 12345, source: 'telegram_scan', data: { total_sum: 145000 } }),
      ev('validated', { outcome: 'ok' }),
      ev('check_round_started', { data: { round: 1, providers: ['proverkacheka'] } }),
      ev('provider_checked', { source: 'proverkacheka', outcome: 'not_found', check: check() }),
      ev('check_round_failed', { outcome: 'not_found', data: { round: 1, next_at: '2026-10-09T10:05:00Z' } }),
    ],
    providers,
  }
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><JourneyPanel receiptId="7" /></QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('JourneyPanel — «Путь чека»', () => {
  it('summary answers received / checked / decided at a glance', async () => {
    getReceiptJourney.mockResolvedValue(journey())
    renderPanel()
    const panel = await screen.findByTestId('journey-panel')
    expect(panel).toHaveTextContent('QR · сканер Telegram')
    expect(panel).toHaveTextContent('Проверка: повтор по расписанию · раундов 1 · следующий')
    expect(panel).toHaveTextContent('Решениеещё нет')
  })

  it('lists every step in order, by whom and from which source', async () => {
    getReceiptJourney.mockResolvedValue(journey())
    renderPanel()
    await screen.findByTestId('journey-panel')
    const steps = screen.getAllByRole('listitem').map((li) => li.getAttribute('data-kind'))
    expect(steps).toEqual(['received', 'validated', 'check_round_started', 'provider_checked', 'check_round_failed'])
    expect(screen.getByText(/Чек получен/).closest('li')).toHaveTextContent('продавец')
    expect(screen.getByText(/Раунд проверки/).closest('li')).toHaveTextContent('№1 · proverkacheka')
    expect(screen.getByText(/Проверка у источника/).closest('li')).toHaveTextContent('proverkacheka · нет данных')
  })

  it('a provider check expands to the exact request and the raw answer (reproducible)', async () => {
    getReceiptJourney.mockResolvedValue(journey())
    renderPanel()
    const step = (await screen.findByText(/Проверка у источника/)).closest('button')!
    fireEvent.click(step)
    const li = step.closest('li')!
    expect(li).toHaveTextContent('раунд 1 · основной · при приёме · по реквизитам · адаптер v1 · HTTP 200 · 120 мс')
    expect(li).toHaveTextContent('"fn": "9960440300712345"')
    expect(li).toHaveTextContent('"code": 2')
  })

  it('shows which providers are connected and lets the admin check at one of them', async () => {
    getReceiptJourney.mockResolvedValue(journey())
    verifyReceiptNow.mockResolvedValue(journey({ verification_status: 'verified', verified_by: 'proverkacheka' }))
    renderPanel()
    const sources = await screen.findByLabelText('Источники проверки')
    expect(sources).toHaveTextContent('10. ФНС не подключён')
    expect(sources).toHaveTextContent('20. proverkacheka основной')
    expect(sources).toHaveTextContent('30. Платформа ОФД выключен')
    expect(screen.queryByRole('button', { name: 'у ФНС' })).toBeNull() // not connected → no button

    fireEvent.click(screen.getByRole('button', { name: 'у proverkacheka' }))
    await waitFor(() => expect(verifyReceiptNow).toHaveBeenCalledWith('7', 'proverkacheka'))
    expect((await within(screen.getByTestId('journey-panel')).findAllByText(/Подтверждён · proverkacheka/)).length).toBeGreaterThan(0)
  })

  it('«Проверить сейчас» runs a full round', async () => {
    getReceiptJourney.mockResolvedValue(journey())
    verifyReceiptNow.mockResolvedValue(journey())
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Проверить сейчас' }))
    await waitFor(() => expect(verifyReceiptNow).toHaveBeenCalledWith('7', undefined))
  })

  it('a decided, verified receipt: decision and confirming source in the summary', async () => {
    getReceiptJourney.mockResolvedValue(journey(
      { verification_status: 'verified', verified_by: 'fns', verified_at: AT, decision: 'approved', decided_at: AT, decided_by: 99 },
      [ev('approved', { actor_type: 'admin', actor_id: 99, data: { bonus_amount: 5000 } })],
    ))
    renderPanel()
    const panel = await screen.findByTestId('journey-panel')
    expect(panel).toHaveTextContent('Подтверждён · ФНС')
    expect(panel).toHaveTextContent('Одобрен')
    expect(panel).toHaveTextContent('админ 99')
    expect(document.querySelector('li[data-kind="approved"]')).toHaveTextContent('Одобрен — бонус 50')
  })

  it('backfilled (history) steps are marked as reconstructed', async () => {
    getReceiptJourney.mockResolvedValue(journey({}, [ev('received', { actor_type: 'seller', data: { backfilled: true } })]))
    renderPanel()
    expect(await screen.findByText(/восстановлено/)).toBeInTheDocument()
  })
})
