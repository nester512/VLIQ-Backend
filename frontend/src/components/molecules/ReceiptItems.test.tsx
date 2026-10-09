import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReceiptItems } from './ReceiptItems'
import { itemsSummary } from '@/utils/receiptItems'

const items = [
  { name: 'VLIQ MAX FLAVOR Манго', price: 70000, qty: 2 },
  { name: 'VLIQ SHOCK Лёд', price: 65000, qty: 1 },
  { name: 'Пакет', price: 500 },
  { name: 'VLIQ HOLODNO PISEC', price: 60000, qty: 3 },
]

describe('ReceiptItems — what was bought (no photo any more)', () => {
  it('lists every product with qty and the line sum (price × qty)', () => {
    render(<ReceiptItems items={items} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('VLIQ MAX FLAVOR Манго ×2')
    expect(rows[0]).toHaveTextContent(/1\s?400/) // 700 ₽ × 2
    expect(rows[2]).toHaveTextContent('Пакет ×1') // no qty = 1
  })

  it('the decision card shows the first lines and «ещё N»', () => {
    render(<ReceiptItems items={items} max={3} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('ещё 1 — в «Подробнее»')).toBeInTheDocument()
  })

  it('without the composition shows the given hint', () => {
    render(<ReceiptItems items={[]} empty={<span>Появится после проверки</span>} />)
    expect(screen.getByText('Появится после проверки')).toBeInTheDocument()
    expect(screen.queryByTestId('receipt-items')).toBeNull()
  })

  it('one-line summary for history rows', () => {
    expect(itemsSummary(items)).toBe('VLIQ MAX FLAVOR Манго ×2 · VLIQ SHOCK Лёд ×1 · ещё 2')
    expect(itemsSummary([])).toBeNull()
    expect(itemsSummary(undefined)).toBeNull()
  })
})
