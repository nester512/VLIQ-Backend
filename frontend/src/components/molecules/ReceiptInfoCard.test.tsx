import { describe, it, expect, afterEach, vi } from 'vitest'
import { render as rtlRender, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import type { AdminReceipt } from '@/api/admin'

const { getAdminReceipt, openSheet } = vi.hoisted(() => ({ getAdminReceipt: vi.fn(), openSheet: vi.fn() }))
vi.mock('@/api/admin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/admin')>()),
  getAdminReceipt,
}))
vi.mock('@/store/uiStore', () => ({ useUiStore: (sel: (s: object) => unknown) => sel({ openSheet }) }))

import { ReceiptInfoCard } from './ReceiptInfoCard'

// The duplicate signal loads the original receipt → the card needs a query client.
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

afterEach(() => { cleanup(); vi.clearAllMocks() })

function base(over: Partial<AdminReceipt> = {}): AdminReceipt {
  return {
    id: '101',
    seller_id: 5,
    seller_name: 'Иван Петров',
    seller_store: 'ТЦ Радуга',
    status: 'on_review',
    shop_name: 'М.Видео',
    shop_address: 'Москва, Тверская 1',
    amount: 250000,
    bonus_amount: 5000,
    fn: '9999078900001234',
    fd: '12345',
    fp: '987654321',
    created_at: '2026-06-20T10:00:00Z',
    attachments: [],
    ...over,
  }
}

describe('ReceiptInfoCard — fiscal data', () => {
  it('renders seller, store, shop and the masked ФН/ФД/ФП', () => {
    render(<ReceiptInfoCard receipt={base()} />)
    expect(screen.getByText('Иван Петров')).toBeInTheDocument()
    expect(screen.getByText('М.Видео')).toBeInTheDocument()
    expect(screen.getByText('Москва, Тверская 1')).toBeInTheDocument()
    // ФН last-6 / ФД / ФП last-4
    expect(screen.getByText('001234 / 12345 / 4321')).toBeInTheDocument()
  })

  it('renders the receipt status pill', () => {
    render(<ReceiptInfoCard receipt={base({ status: 'rejected' })} />)
    expect(screen.getByText('Отклонён')).toBeInTheDocument()
  })

  it('uses warning color for receipts waiting for review', () => {
    render(<ReceiptInfoCard receipt={base({ status: 'on_review', duplicate_status: 'ok' })} />)
    expect(screen.getByText('На проверке').closest('.vliq-pill')).toHaveClass('vliq-pill--wn')
  })

  it('renders a host-supplied actions slot', () => {
    render(<ReceiptInfoCard receipt={base()} actions={<button>Одобрить</button>} />)
    expect(screen.getByRole('button', { name: 'Одобрить' })).toBeInTheDocument()
  })
})

describe('ReceiptInfoCard — system rejection reason (MULTIPLE_RECEIPTS_DETECTED)', () => {
  it('shows the Russian rejection reason text', () => {
    const reason = 'В одной загрузке обнаружено несколько разных чеков. Загрузите по одному.'
    render(
      <ReceiptInfoCard
        receipt={base({
          status: 'rejected',
          rejection_reason: reason,
          detected_identities: [
            { fn: '1111111111111111', fd: '1', fp: '1001' },
            { fn: '2222222222222222', fd: '2', fp: '2002' },
          ],
          fraud_signal: [
            { type: 'multiple_receipts_detected', details: 'В одной загрузке обнаружено несколько разных чеков' },
          ],
        })}
      />,
    )
    // The phrase appears in both the rejection-reason block and the fraud signal.
    expect(screen.getAllByText(/несколько разных чеков/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Причина отклонения:')).toBeInTheDocument()
    // The distinct-identities block lists both fiscal lines.
    expect(screen.getByText('Найдено разных чеков: 2')).toBeInTheDocument()
  })
})

describe('ReceiptInfoCard — duplicate / fraud signals', () => {
  it('renders a historical-duplicate signal with the duplicated receipt id', () => {
    render(
      <ReceiptInfoCard
        receipt={base({
          duplicate_status: 'danger',
          fraud_signal: [
            {
              type: 'historical_duplicate_fn_fd_fp',
              details: 'Дубль по ФН / ФД / ФП — чек уже загружался',
              duplicate_of_id: 77,
            },
          ],
        })}
      />,
    )
    expect(screen.getByText(/Дубль по ФН/)).toBeInTheDocument()
    expect(screen.getByText(/#77/)).toBeInTheDocument()
  })

  it('shows WHICH receipt it duplicates — whose, status, when, bonus — and opens it', async () => {
    const original = base({ id: '77', seller_name: 'Другой продавец', status: 'paid_out', created_at: '2026-09-05T09:30:00Z', bonus_amount: 30000 })
    getAdminReceipt.mockResolvedValue(original)
    render(
      <ReceiptInfoCard
        receipt={base({ fraud_signal: [{ type: 'cross_seller_duplicate', details: 'Чек другого продавца', duplicate_of_id: 77 }] })}
      />,
    )
    const line = await screen.findByTestId('duplicate-of')
    expect(getAdminReceipt).toHaveBeenCalledWith(77)
    expect(line).toHaveTextContent('Совпадает с чеком #77: Другой продавец')
    expect(line).toHaveTextContent('05.09.2026')
    expect(line).toHaveTextContent('300')
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    expect(openSheet).toHaveBeenCalledWith('detail', { receiptId: '77', receipt: original })
  })

  it('a deleted original is said so, not hidden', async () => {
    getAdminReceipt.mockRejectedValue(new Error('404'))
    render(<ReceiptInfoCard receipt={base({ fraud_signal: [{ type: 'historical_duplicate_fn_fd_fp', details: 'Дубль', duplicate_of_id: 5 }] })} />)
    expect(await screen.findByText(/чек #5 — удалён или недоступен/)).toBeInTheDocument()
  })

  it('translates technical duplicate rejection reasons for admins', () => {
    render(
      <ReceiptInfoCard
        receipt={base({
          status: 'rejected',
          rejection_reason: 'QR already used in receipt #227',
          fraud_signal: [
            {
              type: 'qr_raw_duplicate',
              details: 'qr_raw_duplicate',
              duplicate_of_id: 227,
              severity: 'high',
            },
          ],
        })}
      />,
    )

    expect(screen.getByText(/Дубль QR-кода/)).toBeInTheDocument()
    expect(screen.getByText(/QR-код уже использован в чеке #227/)).toBeInTheDocument()
    expect(screen.queryByText(/QR already used/)).toBeNull()
    expect(screen.queryByText(/qr_raw_duplicate/)).toBeNull()
  })

  it('reassures when there are no signals at all', () => {
    render(<ReceiptInfoCard receipt={base()} />)
    expect(screen.getByText('Подозрительной активности не выявлено')).toBeInTheDocument()
  })
})

describe('ReceiptInfoCard — external check link (KAN-12)', () => {
  it('renders the check.ofd.ru link when the fiscal triple is recognised', () => {
    render(<ReceiptInfoCard receipt={base()} />)

    const link = screen.getByTestId('receipt-check-link')
    expect(link.getAttribute('href')).toBe(
      'https://check.ofd.ru/rec/9999078900001234/12345/987654321',
    )
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('hides the link when fiscal data was not recognised', () => {
    render(<ReceiptInfoCard receipt={base({ fp: undefined })} />)
    expect(screen.queryByTestId('receipt-check-link')).toBeNull()
  })
})

describe('ReceiptInfoCard — extraction warnings', () => {
  it('lists OCR extraction warnings', () => {
    render(
      <ReceiptInfoCard
        receipt={base({ extraction_warnings: ['QR не найден на странице 2', 'Низкая чёткость'] })}
      />,
    )
    expect(screen.getByText('QR не найден на странице 2')).toBeInTheDocument()
    expect(screen.getByText('Низкая чёткость')).toBeInTheDocument()
  })
})

describe('ReceiptInfoCard — QR intake badges', () => {
  it('shows where the data came from and the OFD check state', () => {
    render(<ReceiptInfoCard receipt={base({ source: 'manual', verification_status: 'verified' })} />)
    const badges = screen.getByTestId('receipt-intake-badges')
    expect(badges).toHaveTextContent('Ручной ввод данных')
    expect(badges).toHaveTextContent('Подтверждён')
  })

  it('legacy file receipts show no intake badges', () => {
    render(<ReceiptInfoCard receipt={base({ verification_status: 'not_required' })} />)
    expect(screen.queryByTestId('receipt-intake-badges')).toBeNull()
  })
})

describe('ReceiptInfoCard — composition (the photo is gone with QR intake)', () => {
  it('lists the products from the check', () => {
    render(<ReceiptInfoCard receipt={base({ items: [{ name: 'VLIQ MAX FLAVOR', price: 70000, qty: 3 }] })} />)
    expect(screen.getByText('Состав чека · 1')).toBeInTheDocument()
    expect(screen.getByTestId('receipt-items')).toHaveTextContent('VLIQ MAX FLAVOR ×3')
  })

  it('says when the composition will appear (not an empty block)', () => {
    render(<ReceiptInfoCard receipt={base({ items: [] })} />)
    expect(screen.getByTestId('receipt-items-empty')).toHaveTextContent('Состав появится после проверки чека в ФНС / ОФД')
  })
})
