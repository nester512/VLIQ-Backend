import { create } from 'zustand'

export type SheetKind = 'detail' | 'payout' | 'notif'
export type ToastKind = 'ok' | 'dg' | 'wn' | 'info'

export interface Toast {
  id: string
  message: string
  kind: ToastKind
  icon?: string
}

interface SheetEntry {
  sheet: SheetKind
  payload: unknown
}

interface UiState {
  activeSheet: SheetKind | null
  sheetPayload: unknown
  /** Sheets opened FROM another sheet stack up (duplicate → original, payout → receipt):
   *  «← Назад» returns to the previous one instead of losing it. */
  sheetStack: SheetEntry[]
  toastQueue: Toast[]

  openSheet: (sheet: SheetKind, payload?: unknown) => void
  closeSheet: () => void
  /** Back to the sheet this one was opened from (no-op without one). */
  backSheet: () => void
  pushToast: (message: string, kind?: ToastKind, icon?: string, duration?: number) => void
  dismissToast: (id: string) => void
}

let toastCounter = 0

export const useUiStore = create<UiState>()((set) => ({
  activeSheet: null,
  sheetPayload: null,
  sheetStack: [],
  toastQueue: [],

  openSheet: (sheet, payload) => {
    set((state) => ({
      activeSheet: sheet,
      sheetPayload: payload ?? null,
      sheetStack: state.activeSheet ? [...state.sheetStack, { sheet: state.activeSheet, payload: state.sheetPayload }] : [],
    }))
  },

  closeSheet: () => {
    set({ activeSheet: null, sheetPayload: null, sheetStack: [] })
  },

  backSheet: () => {
    set((state) => {
      const prev = state.sheetStack.at(-1)
      if (!prev) return state
      return { activeSheet: prev.sheet, sheetPayload: prev.payload, sheetStack: state.sheetStack.slice(0, -1) }
    })
  },

  pushToast: (message, kind = 'info', icon, duration) => {
    const id = `toast-${++toastCounter}`
    let shown = false
    set((state) => {
      // The same message already on screen is not stacked again (repeated taps on «Далее»).
      if (state.toastQueue.some((t) => t.message === message && t.kind === kind)) {
        shown = true
        return state
      }
      return { toastQueue: [...state.toastQueue, { id, message, kind, icon }] }
    })
    if (shown) return
    // Errors/warnings linger longer so they aren't missed — e.g. a 409 surfaced
    // on submit while the user is looking at a different step. Still tap-to-dismiss.
    const ttl = duration ?? (kind === 'dg' || kind === 'wn' ? 6000 : 3000)
    setTimeout(() => {
      set((state) => ({
        toastQueue: state.toastQueue.filter((t) => t.id !== id),
      }))
    }, ttl)
  },

  dismissToast: (id) => {
    set((state) => ({
      toastQueue: state.toastQueue.filter((t) => t.id !== id),
    }))
  },
}))
