import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Mocks. We drive the REAL extractApiError + REAL authStore so the 401
// self-heal (clear session → re-verify) is exercised; only the auth network
// and the TMA-environment probes are replaced.
// ---------------------------------------------------------------------------

// In a TMA context with signed initData available immediately.
vi.mock('../../utils/tma', () => ({
  isTmaEnvironment: () => true,
  isLikelyTmaContext: () => true,
  getTgWebApp: () => ({ initData: 'init-data-blob', initDataUnsafe: { user: { id: 42 } } }),
  waitForInitData: () => Promise.resolve('init-data-blob'),
}))

// tmaVerify rejects with a 401 envelope. The user_message must be localized and
// carry no token/HMAC/initData/JWT text.
const tmaVerify = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const loginByTgId = vi.fn<(...a: unknown[]) => Promise<unknown>>()
vi.mock('../../api/auth', () => ({
  tmaVerify: (...a: unknown[]) => tmaVerify(...a),
  loginByTgId: (...a: unknown[]) => loginByTgId(...a),
}))

import { useAuthFlow } from './useAuthFlow'
import { useAuthStore } from '../../store/authStore'

beforeEach(() => {
  vi.clearAllMocks()
  // Seed a stale session so we can prove the 401 path clears it.
  useAuthStore.setState({ token: 'stale-jwt-token', role: 'seller', user: null })
})

describe('useAuthFlow — 401 handling', () => {
  it('clears the invalid session and surfaces a localized, token-free message', async () => {
    const unauthorized = {
      isAxiosError: true,
      response: {
        status: 401,
        data: {
          code: 'AUTH_INVALID_SIGNATURE',
          user_message: 'Сессия истекла. Откройте приложение заново из Telegram.',
          debug_id: 'd-401',
        },
      },
    }
    // Reject on every attempt — the self-heal re-runs the flow once.
    tmaVerify.mockRejectedValue(unauthorized)

    const { result } = renderHook(() => useAuthFlow())

    // The stale session must be cleared by the 401 self-heal.
    await waitFor(() => expect(useAuthStore.getState().token).toBeNull())

    // The flow ends in an error state with a localized message (the second pass
    // has no cached token, so it reports the signature-failure copy).
    await waitFor(() => expect(result.current.status).toBe('error'))

    const message = result.current.error ?? ''
    // No leaked token / JWT / HMAC / initData / raw error-code text.
    expect(message).not.toContain('stale-jwt-token')
    expect(message.toLowerCase()).not.toContain('jwt')
    expect(message.toLowerCase()).not.toContain('hmac')
    expect(message.toLowerCase()).not.toContain('init_data')
    expect(message.toLowerCase()).not.toContain('initdata')
    expect(message).not.toContain('AUTH_INVALID_SIGNATURE')
    // It is a non-empty, localized message (Cyrillic copy; proper nouns like
    // "Telegram"/"Mini App" are allowed).
    expect(message.length).toBeGreaterThan(0)
    expect(message).toMatch(/[А-Яа-я]/)

    // The flow re-verified after clearing (initial attempt + one self-heal).
    expect(tmaVerify.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
