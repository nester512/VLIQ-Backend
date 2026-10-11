import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Link } from 'react-router-dom'

// The real router, layouts, header and tab bar; the pages are stubs with the links the real
// pages have. Telegram is a stub of window.Telegram.WebApp with its native BackButton.
vi.mock('../features/admin/pages/DashPage', () => ({
  DashPage: () => <Link to="/admin/sellers">Продавцов</Link>,
}))
vi.mock('../features/admin/pages/SellersPage', () => ({
  SellersPage: () => <Link to="/admin/sellers/7/receipts">Продавец 7</Link>,
}))
vi.mock('../features/admin/pages/SellerReceiptsPage', () => ({
  SellerReceiptsPage: () => <Link to="/admin/payouts?seller=7">Выплаты продавца</Link>,
}))
vi.mock('../features/admin/pages/PayoutsPage', () => ({
  PayoutsPage: () => <div>Экран выплат</div>,
}))
vi.mock('../features/seller/pages/HomePage', () => ({
  HomePage: () => <><Link to="/seller/history">Все</Link><Link to="/seller/promo">Акции</Link></>,
}))
vi.mock('../features/seller/pages/HistoryPage', () => ({ HistoryPage: () => <div>История</div> }))
vi.mock('../api/sellers', () => ({ getMe: () => Promise.resolve({ status: 'active' }) }))
vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))

import { AppRouter } from './AppRouter'
import { resetBackNav } from './backNav'
import { useAuthStore } from '../store/authStore'

const back = { visible: false, handlers: [] as Array<() => void> }
const BackButton = {
  show: () => { back.visible = true },
  hide: () => { back.visible = false },
  onClick: (cb: () => void) => { back.handlers.push(cb) },
  offClick: (cb: () => void) => { back.handlers = back.handlers.filter((h) => h !== cb) },
}
const pressBack = () => act(() => { back.handlers.at(-1)?.() })

function renderApp(path: string, role: 'admin' | 'seller') {
  window.history.replaceState(null, '', path)
  useAuthStore.setState({ token: 't', role })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter><AppRouter /></BrowserRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  resetBackNav()
  back.visible = false
  back.handlers = []
  Object.assign(window, { Telegram: { WebApp: { initData: 'signed', initDataUnsafe: {}, colorScheme: 'dark', close() {}, ready() {}, BackButton } } })
})
afterEach(() => {
  cleanup()
  delete (window as { Telegram?: unknown }).Telegram
})

const go = async (text: string) => fireEvent.click(await screen.findByText(text))
const at = (path: string) => waitFor(() => expect(window.location.pathname + window.location.search).toBe(path))

describe('Telegram «назад» — several steps deep (owner, 2026-10-11)', () => {
  it('Сводка → Продавцы → продавец → Выплаты продавца: «назад» on every step, back to the dashboard', async () => {
    renderApp('/admin/dash', 'admin')
    await screen.findByText('Продавцов')
    expect(back.visible).toBe(false)

    await go('Продавцов'); await at('/admin/sellers')
    await waitFor(() => expect(back.visible).toBe(true))
    await go('Продавец 7'); await at('/admin/sellers/7/receipts')
    await go('Выплаты продавца'); await at('/admin/payouts?seller=7')
    await waitFor(() => expect(back.visible).toBe(true))

    pressBack(); await at('/admin/sellers/7/receipts')
    await waitFor(() => expect(back.visible).toBe(true))
    pressBack(); await at('/admin/sellers')
    await waitFor(() => expect(back.visible).toBe(true))
    pressBack(); await at('/admin/dash')
    await waitFor(() => expect(back.visible).toBe(false))
  })

  it('a tab tap makes the screen a root: no «назад»', async () => {
    renderApp('/admin/dash', 'admin')
    await go('Продавцов'); await at('/admin/sellers')
    await waitFor(() => expect(back.visible).toBe(true))
    fireEvent.click(screen.getByRole('link', { name: /Выплаты/ }))
    await at('/admin/payouts')
    await waitFor(() => expect(back.visible).toBe(false))
  })

  it('seller: a tab screen opened from the home screen («Все», «Акции») has «назад»', async () => {
    renderApp('/seller/home', 'seller')
    await go('Все'); await at('/seller/history')
    await waitFor(() => expect(back.visible).toBe(true))
    pressBack(); await at('/seller/home')
    await waitFor(() => expect(back.visible).toBe(false))
  })
})
