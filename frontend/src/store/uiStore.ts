import { create } from 'zustand'

export type SheetKind = 'detail' | 'seller' | 'payout' | 'notif'
export type ToastKind = 'ok' | 'dg' | 'wn' | 'info'

export interface Toast {
  id: string
  message: string
  kind: ToastKind
  icon?: string
}

interface UiState {
  activeSheet: SheetKind | null
  sheetPayload: unknown
  toastQueue: Toast[]

  openSheet: (sheet: SheetKind, payload?: unknown) => void
  closeSheet: () => void
  pushToast: (message: string, kind?: ToastKind, icon?: string, duration?: number) => void
  dismissToast: (id: string) => void
}

let toastCounter = 0

export const useUiStore = create<UiState>()((set) => ({
  activeSheet: null,
  sheetPayload: null,
  toastQueue: [],

  openSheet: (sheet, payload) => {
    set({ activeSheet: sheet, sheetPayload: payload ?? null })
  },

  closeSheet: () => {
    set({ activeSheet: null, sheetPayload: null })
  },

  pushToast: (message, kind = 'info', icon, duration) => {
    const id = `toast-${++toastCounter}`
    set((state) => ({
      toastQueue: [...state.toastQueue, { id, message, kind, icon }],
    }))
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
