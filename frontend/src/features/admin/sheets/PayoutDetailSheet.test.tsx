import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PayoutRequest } from '@/types/models'

const { takePayoutRequest, approvePayoutRequest, rejectPayoutRequest, getPayoutReceipts } = vi.hoisted(() => ({
  takePayoutRequest: vi.fn(),
  approvePayoutRequest: vi.fn(),
  rejectPayoutRequest: vi.fn(),
  getPayoutReceipts: vi.fn(),
}))
vi.mock('@/api/admin', () => ({
  takePayoutRequest, approvePayoutRequest, rejectPayoutRequest, getPayoutReceipts,
  getAdminPayouts: vi.fn(), getPayoutSummary: vi.fn(),
}))
vi.mock('@/store/uiStore', () => ({
  useUiStore: (sel: (s: object) => unknown) => sel({ pushToast: vi.fn(), closeSheet: vi.fn() }),
}))
vi.mock('@/components/molecules/RejectReasonSheet', () => ({
  RejectReasonSheet: ({ open, onConfirm }: { open: boolean; onConfirm: (r: string) => void }) =>
    open ? <button type="button" onClick={() => onConfirm('Неверный номер')}>confirm-reason</button> : null,
}))

import { PayoutDetailSheet } from './PayoutDetailSheet'

const payout = (over: Partial<PayoutRequest> = {}): PayoutRequest => ({
  id: '5', seller_id: 9, seller_name: 'Продавец', amount: 300_000, method: 'sbp_phone', details: '+79990000000',
  status: 'new', created_at: '2026-10-09T10:00:00Z', seller_status: 'active', ...over,
})

function renderSheet(p: PayoutRequest) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><PayoutDetailSheet payoutId={p.id} payout={p} /></QueryClientProvider>)
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('PayoutDetailSheet', () => {
  it('shows the receipts the request covers', async () => {
    getPayoutReceipts.mockResolvedValue([
      { receipt_id: 11, amount: 200_000, bonus_amount: 200_000, receipt_status: 'approved', purchase_date: null, total_sum: null },
      { receipt_id: 12, amount: 100_000, bonus_amount: 300_000, receipt_status: 'approved', purchase_date: null, total_sum: null },
    ])
    renderSheet(payout())
    const list = await screen.findByLabelText('Чеки в заявке')
    await waitFor(() => expect(list).toHaveTextContent('Чек #11'))
    expect(list).toHaveTextContent('из') // the second one is covered partially
  })

  it('take → «Выплачено» with the transaction id; reject only with a reason', async () => {
    getPayoutReceipts.mockResolvedValue([])
    takePayoutRequest.mockResolvedValue(payout({ status: 'in_progress' }))
    approvePayoutRequest.mockResolvedValue(payout({ status: 'paid' }))
    rejectPayoutRequest.mockResolvedValue(payout({ status: 'rejected' }))
    renderSheet(payout())

    fireEvent.click(screen.getByRole('button', { name: /Взять в работу/ }))
    await waitFor(() => expect(takePayoutRequest).toHaveBeenCalledWith('5'))

    fireEvent.change(screen.getByLabelText('Номер транзакции'), { target: { value: 'SBP-77' } })
    fireEvent.click(screen.getByRole('button', { name: /Выплачено/ }))
    await waitFor(() => expect(approvePayoutRequest).toHaveBeenCalledWith('5', 'SBP-77'))

    fireEvent.click(screen.getByRole('button', { name: /Отклонить/ }))
    fireEvent.click(screen.getByText('confirm-reason'))
    await waitFor(() => expect(rejectPayoutRequest).toHaveBeenCalledWith('5', 'Неверный номер'))
  })

  it('a blocked seller cannot be paid — only refused', async () => {
    getPayoutReceipts.mockResolvedValue([])
    renderSheet(payout({ seller_status: 'blocked' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Продавец заблокирован')
    expect(screen.queryByRole('button', { name: /Выплачено/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Взять в работу/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Отклонить/ })).toBeEnabled()
  })
})
