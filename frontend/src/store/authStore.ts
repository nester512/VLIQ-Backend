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
  setAuth: (token: string, role: UserRole, user?: AuthUser) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      user: null,

      setAuth: (token, role, user) => {
        set({ token, role, user: user ?? null })
      },

      logout: () => {
        set({ token: null, role: null, user: null })
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
