import { api } from './client'
import type { UserRole } from "../store/authStore"

export interface LoginByTgIdPayload {
  id: number
}

export interface LoginResponse {
  access_token: string
  role: UserRole
}

export interface TmaVerifyPayload {
  init_data: string
}

/** Dev-only: login by telegram_id without HMAC verification */
export const loginByTgId = (payload: LoginByTgIdPayload) =>
  api.post<LoginResponse>('/auth/login', payload).then((r) => r.data)

/** DEV only: reset the fixed temporary seller used for registration checks. */
export const resetMockRegistrationSeller = () =>
  api.delete('/auth/dev/mock-registration-seller')

/**
 * Production: verify TMA initData with HMAC on the backend.
 * Backend endpoint POST /auth/tma-verify is planned (P0 punch-list B1).
 * TODO: implement when backend adds /auth/tma-verify
 */
export const tmaVerify = (payload: TmaVerifyPayload) =>
  api.post<LoginResponse>('/auth/tma-verify', payload).then((r) => r.data)
