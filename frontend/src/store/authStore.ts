import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type UserRole = 'seller' | 'admin' | 'super_admin'

export interface AuthUser {
  id: number
  telegram_id?: number
  name?: string
  [key: string]: unknown
}

interface AuthState {
  token: string | null
  role: UserRole | null
  user: AuthUser | null
  /** Why the server shut this account out (blocked, switched off, moved) — the app shows
   *  it instead of the screens. Not persisted: the next open asks the server again. */
  revoked: string | null
  setAuth: (token: string, role: UserRole, user?: AuthUser) => void
  logout: () => void
  revoke: (message: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      user: null,
      revoked: null,

      setAuth: (token, role, user) => {
        set({ token, role, user: user ?? null, revoked: null })
      },

      logout: () => {
        set({ token: null, role: null, user: null })
      },

      revoke: (message) => {
        set({ token: null, role: null, user: null, revoked: message })
      },
    }),
    {
      name: 'vliq-auth',
      // Token + role only — `user` PII (telegram id, names, payout fragments)
      // is re-hydrated from /sellers/me on demand and never persisted to
      // localStorage, where XSS could lift it.
      partialize: (state) => ({ token: state.token, role: state.role }),
    },
  ),
)

// Raw getter for use outside React (axios interceptors)
export const authStore = useAuthStore
