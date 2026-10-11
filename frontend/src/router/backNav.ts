import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useUiStore } from '@/store/uiStore'

/**
 * «Назад» by how the screen was reached, not by which screen it is.
 *
 * A screen opened by a tap inside the app (a dashboard card, «Выплаты продавца», a seller from the
 * top list) gets a back button even when it is also a tab; a screen opened from the tab bar is a
 * root and has none. The rule: back is shown while the current history entry is deeper than the
 * entry the last tab tap (or the app start) landed on. Filter changes replace the entry, so they
 * never add or remove the back button.
 */

function historyIdx(): number {
  const state = window.history.state as { idx?: unknown } | null
  return typeof state?.idx === 'number' ? state.idx : 0
}

// Root of the current back stack. Mutated only through these functions; resolving is idempotent,
// so a repeated render of the same history entry gives the same answer.
const root: { idx: number | null; tabTapPending: boolean } = { idx: null, tabTapPending: false }

function resolveCanGoBack(idx: number): boolean {
  if (root.idx === null || root.tabTapPending) {
    root.idx = idx
    root.tabTapPending = false
  } else if (idx < root.idx) {
    root.idx = idx // went back past the root (system back): that entry is the new root
  }
  return idx > root.idx
}

/** Called by the tab bar: the screen it opens is a root (no «назад»). */
export function markTabNavigation(): void {
  root.tabTapPending = true
}

/** Test helper: forget the root between test cases. */
export function resetBackNav(): void {
  root.idx = null
  root.tabTapPending = false
}

export function useCanGoBack(): boolean {
  const location = useLocation()
  return useMemo(() => {
    return resolveCanGoBack(historyIdx())
    // location.key changes on every navigation, including back/forward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])
}

// ---- Leaving a sheet for a page, and coming back to it ---------------------------------------

interface ReopenSheets {
  activeSheet: ReturnType<typeof useUiStore.getState>['activeSheet']
  sheetPayload: unknown
  sheetStack: ReturnType<typeof useUiStore.getState>['sheetStack']
}

/**
 * Go from an open sheet (a receipt, a payout) to a page. The open sheets are remembered in the
 * entry we leave, so «назад» brings the admin back to the same card, not to the bare list.
 */
export function useNavigateFromSheet() {
  const navigate = useNavigate()
  const location = useLocation()
  return (to: string) => {
    const { activeSheet, sheetPayload, sheetStack, closeSheet } = useUiStore.getState()
    if (activeSheet) {
      const reopen: ReopenSheets = { activeSheet, sheetPayload, sheetStack }
      const prev = (location.state as Record<string, unknown> | null) ?? {}
      navigate(`${location.pathname}${location.search}`, { replace: true, state: { ...prev, reopenSheets: reopen } })
    }
    closeSheet()
    navigate(to)
  }
}

/** On return to an entry that remembers sheets, open them again (once). */
export function useReopenSheetsOnReturn(): void {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const state = location.state as { reopenSheets?: ReopenSheets } | null
    const reopen = state?.reopenSheets
    if (!reopen?.activeSheet) return
    useUiStore.setState({ activeSheet: reopen.activeSheet, sheetPayload: reopen.sheetPayload, sheetStack: reopen.sheetStack ?? [] })
    const rest = { ...state }
    delete rest.reopenSheets
    navigate(`${location.pathname}${location.search}`, { replace: true, state: Object.keys(rest).length ? rest : null })
  }, [location, navigate])
}
