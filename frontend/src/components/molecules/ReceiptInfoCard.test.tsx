import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ReceiptInfoCard } from './ReceiptInfoCard'
import type { AdminReceipt } from '@/api/admin'

afterEach(cleanup)

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

  it('reassures when there are no signals at all', () => {
    render(<ReceiptInfoCard receipt={base()} />)
    expect(screen.getByText('Подозрительной активности не выявлено')).toBeInTheDocument()
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
