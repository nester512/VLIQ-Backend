import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Link, Route, Routes, useNavigate } from 'react-router-dom'
import { markTabNavigation, resetBackNav, useCanGoBack, useNavigateFromSheet, useReopenSheetsOnReturn } from './backNav'
import { useUiStore } from '@/store/uiStore'

function Probe() {
  const canGoBack = useCanGoBack()
  const navigate = useNavigate()
  const navigateFromSheet = useNavigateFromSheet()
  useReopenSheetsOnReturn()
  return (
    <>
      <div data-testid="back">{canGoBack ? 'back' : 'root'}</div>
      <Link to="/admin/payouts?seller=7">Выплаты продавца</Link>
      <Link to="/admin/payouts" onClick={markTabNavigation}>Вкладка Выплаты</Link>
      <button type="button" onClick={() => navigate('/admin/payouts?status=paid', { replace: true })}>Фильтр</button>
      <button type="button" onClick={() => navigate(-1)}>Назад</button>
      <button type="button" onClick={() => navigateFromSheet('/admin/sellers/7/receipts')}>К продавцу</button>
    </>
  )
}

function renderApp() {
  return render(
    <BrowserRouter>
      <Routes><Route path="*" element={<Probe />} /></Routes>
    </BrowserRouter>,
  )
}

const back = () => screen.getByTestId('back').textContent

beforeEach(() => {
  window.history.replaceState(null, '', '/admin/dash')
  resetBackNav()
  useUiStore.getState().closeSheet()
})
afterEach(cleanup)

describe('«Назад» by how the screen was reached', () => {
  it('a screen opened by a tap inside the app has «назад», even when it is also a tab', () => {
    renderApp()
    expect(back()).toBe('root')
    fireEvent.click(screen.getByText('Выплаты продавца'))
    expect(back()).toBe('back')
  })

  it('a filter change keeps «назад»; a tab tap makes the screen a root again', () => {
    renderApp()
    fireEvent.click(screen.getByText('Выплаты продавца'))
    fireEvent.click(screen.getByText('Фильтр'))
    expect(back()).toBe('back')
    fireEvent.click(screen.getByText('Вкладка Выплаты'))
    expect(back()).toBe('root')
  })

  it('«назад» returns to the root, which has no «назад»', async () => {
    renderApp()
    fireEvent.click(screen.getByText('Выплаты продавца'))
    fireEvent.click(screen.getByText('Назад'))
    await waitFor(() => expect(back()).toBe('root'))
    expect(window.location.pathname).toBe('/admin/dash')
  })
})

describe('leaving a card for a page and coming back', () => {
  it('the card that was open is open again after «назад»', async () => {
    renderApp()
    act(() => {
      useUiStore.getState().openSheet('payout', { payoutId: '5' })
      useUiStore.getState().openSheet('detail', { receiptId: '11' })
    })
    fireEvent.click(screen.getByText('К продавцу'))
    expect(window.location.pathname).toBe('/admin/sellers/7/receipts')
    expect(useUiStore.getState().activeSheet).toBeNull()

    fireEvent.click(screen.getByText('Назад'))
    await waitFor(() => expect(useUiStore.getState().activeSheet).toBe('detail'))
    expect(useUiStore.getState()).toMatchObject({ sheetPayload: { receiptId: '11' }, sheetStack: [{ sheet: 'payout' }] })
    expect(window.location.pathname).toBe('/admin/dash')
  })
})
