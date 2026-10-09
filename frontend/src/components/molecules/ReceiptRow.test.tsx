import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReceiptRow } from './ReceiptRow'

describe('ReceiptRow (seller history) — products at a glance', () => {
  it('shows a one-line composition when the check returned it', () => {
    render(<ReceiptRow onClick={vi.fn()} receipt={{ id: '7', seller_id: 1, status: 'approved', created_at: '2026-10-09T10:00:00Z',
      items: [{ name: 'VLIQ MAX FLAVOR', price: 70000, qty: 2 }, { name: 'VLIQ SHOCK', price: 65000 }] }} />)  // prettier-ignore
    expect(screen.getByTestId('row-items')).toHaveTextContent('VLIQ MAX FLAVOR ×2 · VLIQ SHOCK ×1')
  })

  it('no composition yet → no empty line', () => {
    render(<ReceiptRow onClick={vi.fn()} receipt={{ id: '8', seller_id: 1, status: 'on_review', created_at: '2026-10-09T10:00:00Z' }} />)
    expect(screen.queryByTestId('row-items')).toBeNull()
  })
})
