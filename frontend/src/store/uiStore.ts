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
  pushToast: (message: string, kind?: ToastKind, icon?: string) => void
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

  pushToast: (message, kind = 'info', icon) => {
    const id = `toast-${++toastCounter}`
    set((state) => ({
      toastQueue: [...state.toastQueue, { id, message, kind, icon }],
    }))
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      set((state) => ({
        toastQueue: state.toastQueue.filter((t) => t.id !== id),
      }))
    }, 3000)
  },

  dismissToast: (id) => {
    set((state) => ({
      toastQueue: state.toastQueue.filter((t) => t.id !== id),
    }))
  },
}))
