import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { fmtMoneyDelta } from '@/utils/formatMoney'
import { AccrualRow } from './AccrualRow'
import type { BonusTransaction } from '@/types/models'

afterEach(cleanup)

const base: BonusTransaction = {
  id: '1',
  seller_id: 9,
  type: 'bonus',
  amount: 10000,
  description: 'Ручное начисление',
  created_at: '2026-06-17T00:00:00Z',
}

describe('AccrualRow — money rendered from kopecks', () => {
  it('shows a 10000-kopeck accrual as +100 ₽, not raw kopecks', () => {
    render(<AccrualRow transaction={base} />)
    // Regression: was rendering `${Math.abs(amount)} ₽` → "+10000 ₽".
    expect(fmtMoneyDelta(10000)).toBe('+100 ₽')
    expect(screen.getByTitle('+100 ₽')).toBeTruthy()
    expect(screen.queryByText('+10000 ₽')).toBeNull()
  })

  it('shows a negative payout in rubles with a minus sign', () => {
    render(
      <AccrualRow
        transaction={{ ...base, amount: -5800, type: 'payout', description: 'Выплата' }}
      />,
    )
    const expected = fmtMoneyDelta(-5800)
    expect(expected).toContain('58')
    expect(expected).not.toContain('5800')
    expect(screen.getByTitle(expected)).toBeTruthy()
  })
})

describe('AccrualRow — a debit is not shown as an accrual (regress 2026-10-11)', () => {
  it('a negative correction (cancelled receipt / lowered bonus) is red; an accrual is green; a payout neutral', () => {
    render(<AccrualRow transaction={{ ...base, type: 'adjustment', amount: -200, description: 'Корректировка' }} />)
    expect(screen.getByTitle('−2 ₽').dataset.tone).toBe('dg')
    cleanup()
    render(<AccrualRow transaction={{ ...base, type: 'adjustment', amount: 200, description: 'Корректировка' }} />)
    expect(screen.getByTitle('+2 ₽').dataset.tone).toBe('ok')
    cleanup()
    render(<AccrualRow transaction={{ ...base, type: 'payout', amount: -300000, description: 'Резерв на выплату' }} />)
    expect(screen.getByTitle('−3 000 ₽').dataset.tone).toBe('neutral') // the query normalises the DOM's thousands space
  })
})
