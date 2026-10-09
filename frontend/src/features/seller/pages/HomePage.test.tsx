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
    const question = screen.getByRole('button', { name: 'Участвуют ли коллаборации в системе мотивации?' })
    expect(question).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(question)
    expect(question).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Нет. В системе мотивации участвуют только актуальные линейки бренда VLIQ.')).toBeInTheDocument()
  })
})

describe('HomePage — FAQ: several outlets, profile data, login, lost account', () => {
  it.each([
    ['Можно ли работать в нескольких магазинах сети?', /любых торговых точек сети/],
    ['Почему торговая точка из регистрации не ограничивает работу?', /Приём чеков к ней не привязан/],
    ['Можно ли изменить данные профиля?', /реквизиты для выплаты вы вводите в каждой заявке/],
    ['Влияет ли смена username в Telegram на вход?', /username можно менять/],
    ['Что делать, если потерян доступ к аккаунту Telegram?', /сотрудник перенесёт доступ/],
  ])('«%s» is answered', (question, answer) => {
    render(<MemoryRouter><HomePage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: question }))
    expect(screen.getByText(answer)).toBeInTheDocument()
  })
})
