import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'

// A blocked seller, a switched-off admin or a moved Telegram account must leave the app at
// once with the server's reason — not keep working on a cached 6-day token, and not show
// «Не удалось проверить подпись Telegram» (UC-S1, UC-OP1, UC-OP2).

vi.mock('../../utils/tma', () => ({
  isTmaEnvironment: () => true,
  isLikelyTmaContext: () => true,
  getTgWebApp: () => ({ initData: 'init-data-blob', initDataUnsafe: { user: { id: 42 } } }),
  waitForInitData: () => Promise.resolve('init-data-blob'),
}))

const tmaVerify = vi.fn<(...a: unknown[]) => Promise<unknown>>()
vi.mock('../../api/auth', () => ({
  tmaVerify: (...a: unknown[]) => tmaVerify(...a),
  loginByTgId: vi.fn(),
}))

import { useAuthFlow } from './useAuthFlow'
import { AuthGate } from './AuthGate'
import { useAuthStore } from '../../store/authStore'
import { api } from '../../api/client'

const BLOCKED = 'Ваш аккаунт заблокирован. Обратитесь в поддержку.'
const ADMIN_OFF = 'Ваш доступ администратора отключён. Если это ошибка — обратитесь к владельцу программы.'
const MOVED = 'Этот аккаунт Telegram отключён: доступ перенесён на новый аккаунт.'

function refusal(code: string, message: string, status = 403) {
  return { isAxiosError: true, response: { status, data: { code, user_message: message, debug_id: 'd' } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ token: null, role: null, user: null, revoked: null })
})

describe('opening the app after the account was shut out', () => {
  it('blocked seller with a still-valid cached token: the token is dropped and the reason shown', async () => {
    useAuthStore.setState({ token: 'cached-jwt', role: 'seller' })
    tmaVerify.mockRejectedValue(refusal('SELLER_BLOCKED', BLOCKED))

    const { result } = renderHook(() => useAuthFlow())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe(BLOCKED)
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('switched-off admin with a still-valid cached token: no admin screens, the reason is shown', async () => {
    useAuthStore.setState({ token: 'cached-admin-jwt', role: 'admin' })
    tmaVerify.mockRejectedValue(refusal('ADMIN_DISABLED', ADMIN_OFF))

    render(<AuthGate><p>Экраны администратора</p></AuthGate>)

    expect(await screen.findByText(ADMIN_OFF)).toBeInTheDocument()
    expect(screen.queryByText('Экраны администратора')).not.toBeInTheDocument()
  })

  it('blocked seller without a cached token sees «заблокирован», not the Telegram-signature message', async () => {
    tmaVerify.mockRejectedValue(refusal('SELLER_BLOCKED', BLOCKED))

    const { result } = renderHook(() => useAuthFlow())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe(BLOCKED)
    expect(result.current.error).not.toContain('подпись')
  })
})

describe('the account is shut out while the app is open', () => {
  // Answer every request through the real axios instance (interceptors included).
  function serverAnswers(code: string, message: string, status: number) {
    const adapter: AxiosAdapter = (config: InternalAxiosRequestConfig) =>
      Promise.reject(new AxiosError(message, String(status), config, null, {
        status, statusText: '', headers: {}, config, data: { code, user_message: message, debug_id: 'd' },
      }))
    return adapter
  }

  it('any refused request with ACCOUNT_MOVED closes the app with the reason', async () => {
    useAuthStore.setState({ token: 'old-account-jwt', role: 'seller' })
    tmaVerify.mockResolvedValue({ access_token: 'old-account-jwt', role: 'seller' })
    render(<AuthGate><p>Главная продавца</p></AuthGate>)
    expect(await screen.findByText('Главная продавца')).toBeInTheDocument()

    await expect(api.get('/sellers/me/balance', { adapter: serverAnswers('ACCOUNT_MOVED', MOVED, 403) })).rejects.toBeTruthy()

    expect(await screen.findByText(MOVED)).toBeInTheDocument()
    expect(screen.queryByText('Главная продавца')).not.toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('an ordinary 403 (no rights for one action) does not close the app', async () => {
    useAuthStore.setState({ token: 'jwt', role: 'seller' })
    await expect(
      api.get('/x', { adapter: serverAnswers('AUTH_FORBIDDEN', 'У вас нет доступа к этому действию.', 403) }),
    ).rejects.toBeTruthy()
    expect(useAuthStore.getState().token).toBe('jwt')
    expect(useAuthStore.getState().revoked).toBeNull()
  })

  it('a 401 while open (admin role changed) logs in again instead of hanging', async () => {
    useAuthStore.setState({ token: 'super-admin-jwt', role: 'admin' })
    tmaVerify.mockResolvedValue({ access_token: 'super-admin-jwt', role: 'admin' })
    render(<AuthGate><p>Экраны администратора</p></AuthGate>)
    expect(await screen.findByText('Экраны администратора')).toBeInTheDocument()
    tmaVerify.mockResolvedValue({ access_token: 'fresh-admin-jwt', role: 'admin' })

    await expect(
      api.get('/analytics/dashboard', { adapter: serverAnswers('AUTH_TOKEN_STALE', 'Сессия устарела.', 401) }),
    ).rejects.toBeTruthy()

    await waitFor(() => expect(useAuthStore.getState().token).toBe('fresh-admin-jwt'))
    expect(await screen.findByText('Экраны администратора')).toBeInTheDocument()
  })
})
