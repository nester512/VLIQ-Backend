import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

vi.mock('@/api/sellers', () => ({ getMe: () => Promise.resolve({ first_name: 'Тест', last_name: 'Продавец', store_name: 'Точка', city: 'Москва' }) }))
vi.mock('@/store/uiStore', () => ({ useUiStore: (sel: (s: object) => unknown) => sel({ pushToast: vi.fn() }) }))
vi.mock('@/store/authStore', () => ({ useAuthStore: (sel: (s: object) => unknown) => sel({ user: { id: 1 }, logout: vi.fn() }) }))

import { ProfilePage } from './ProfilePage'

describe('ProfilePage — FAQ in the profile too', () => {
  it('has the same «Вопросы и ответы» block, incl. several outlets and a lost account', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><ProfilePage /></MemoryRouter>
      </QueryClientProvider>,
    )
    const faq = screen.getByRole('region', { name: 'Вопросы и ответы' })
    fireEvent.click(within(faq).getByRole('button', { name: 'Можно ли работать в нескольких магазинах сети?' }))
    expect(within(faq).getByText(/любых торговых точек сети/)).toBeInTheDocument()
    expect(within(faq).getByRole('button', { name: 'Что делать, если потерян доступ к аккаунту Telegram?' })).toBeInTheDocument()
  })
})
