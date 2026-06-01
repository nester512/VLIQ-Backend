import { useCallback, useEffect, useState } from 'react'
import { loginByTgId, tmaVerify } from '../../api/auth'
import { useAuthStore } from '../../store/authStore'
import { isTmaEnvironment, isLikelyTmaContext, waitForInitData, getTgWebApp } from '../../utils/tma'

type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error'

interface AuthFlowState {
  status: AuthStatus
  error: string | null
  /** Only present in DEV mode when not in TMA context */
  mockLogin?: () => void
}

const MOCK_TELEGRAM_ID = 12345 // matches local seed_dev.sql

/**
 * Manages the TMA authentication flow.
 *
 * Flow:
 *   1. Inside Telegram: POST `/auth/tma-verify` with `initData` (HMAC-validated server-side).
 *   2. **DEV only**: fall back to `/auth/login` with the unverified telegram_id from
 *      `initDataUnsafe`. This is gated behind `import.meta.env.DEV` because the
 *      `/auth/login` endpoint accepts a bare ID with no signature — using it as a
 *      production fallback would let any client mint a token for any user.
 */
export function useAuthFlow(): AuthFlowState {
  const { token, setAuth } = useAuthStore()
  const [status, setStatus] = useState<AuthStatus>(token ? 'authenticated' : 'idle')
  const [error, setError] = useState<string | null>(null)

  const doAuth = useCallback(async () => {
    setStatus('loading')
    setError(null)

    try {
      // On Android, `initData` may arrive ~200-1500ms AFTER WebView paint.
      // If we're clearly inside Telegram WebView (object exists, fragment
      // present, or UA hints), wait until the signed initData lands rather
      // than instantly bailing with "outside Telegram".
      const inTmaContext = isTmaEnvironment() || isLikelyTmaContext()
      if (inTmaContext) {
        const initData = isTmaEnvironment() ? getTgWebApp()?.initData : await waitForInitData(2500)
        const wa = getTgWebApp()
        const tgUserId = wa?.initDataUnsafe?.user?.id

        if (initData) {
          try {
            const result = await tmaVerify({ init_data: initData })
            setAuth(result.access_token, result.role)
            setStatus('authenticated')
            return
          } catch (verifyErr) {
            // DEV escape hatch only — never in prod, where this would be an auth bypass.
            if (import.meta.env.DEV && tgUserId) {
              try {
                const result = await loginByTgId({ id: tgUserId })
                setAuth(result.access_token, result.role)
                setStatus('authenticated')
                return
              } catch (loginErr) {
                console.warn('[auth] /auth/login dev-fallback failed', loginErr)
              }
            } else {
              console.warn('[auth] /auth/tma-verify failed', verifyErr)
            }
          }
        }
      }

      setStatus('error')
      // If we know we're in TMA (initData present or strong context hints),
      // the failure was a signature/network problem — not "outside Telegram".
      const stillInTma = isTmaEnvironment() || isLikelyTmaContext()
      setError(
        stillInTma
          ? 'Не удалось проверить подпись Telegram. Перезайдите в Mini App.'
          : 'Приложение доступно только через Telegram.',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка авторизации'
      setStatus('error')
      setError(message)
    }
  }, [setAuth])

  useEffect(() => {
    if (token) return
    // All state updates happen inside the async function, not directly in the
    // effect body, so the react-hooks/set-state-in-effect rule is satisfied.
    void (async () => {
      // Trust likely-TMA context too — doAuth will internally wait up to
      // 2.5s for initData to arrive (Android delay).
      if (isTmaEnvironment() || isLikelyTmaContext()) {
        await doAuth()
      } else if (!import.meta.env.DEV) {
        setStatus('error')
        setError('Приложение доступно только через Telegram.')
      } else {
        setStatus('idle')
      }
    })()
  }, [token, doAuth])

  const mockLogin = import.meta.env.DEV
    ? async () => {
        setStatus('loading')
        setError(null)
        try {
          const result = await loginByTgId({ id: MOCK_TELEGRAM_ID })
          setAuth(result.access_token, result.role)
          setStatus('authenticated')
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Ошибка mock-логина'
          setStatus('error')
          setError(message)
        }
      }
    : undefined

  return { status, error, mockLogin }
}
