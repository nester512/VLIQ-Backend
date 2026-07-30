import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
})

vi.mock('../hooks/useBalance', () => ({
  useBalance: () => ({ data: { available: 0, pending: 0, total_earned: 0 }, isLoading: false }),
}))

vi.mock('../hooks/useReceipts', () => ({
  useReceipts: () => ({ data: [], isLoading: false }),
}))

import { HomePage } from './HomePage'

describe('HomePage — FAQ', () => {
  it('shows static answers below the main home content and expands one on demand', () => {
    render(<MemoryRouter><HomePage /></MemoryRouter>)

    expect(screen.getByText('Вопросы и ответы')).toBeInTheDocument()
    const question = screen.getByRole('button', { name: 'Нужно ли сканировать QR-код?' })
    expect(question).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(question)
    expect(question).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Нет. QR-код можно добавить для удобства, но он не обязателен.')).toBeInTheDocument()
  })
})
