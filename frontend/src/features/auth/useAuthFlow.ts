import { useCallback, useEffect, useRef, useState } from 'react'
import { loginByTgId, tmaVerify } from '../../api/auth'
import { extractApiError } from '../../api/client'
import { useAuthStore, type UserRole } from '../../store/authStore'
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
    // Apply a fresh session. If the role changed (e.g. seller → admin after
    // being added to the admin table), reboot at "/" so RoleRedirect routes to
    // the correct home — useAuthFlow lives above the Router, so we can't navigate().
    const applyAuth = (accessToken: string, role: UserRole, prevRole: UserRole | null) => {
      setAuth(accessToken, role)
      setStatus('authenticated')
      if (prevRole && role !== prevRole) window.location.assign('/')
    }

    // A 401 means the cached session (if any) is invalid — clear it and re-run
    // the verification ONCE from a clean slate rather than keeping a dead token.
    // The loop runs at most twice (initial attempt + one self-heal).
    for (let attempt = 0; attempt < 2; attempt++) {
      // Snapshot the persisted session BEFORE re-verifying. When a token already
      // exists this is a silent background refresh — keep rendering the app (no
      // blocking loader) and never tear the session down on a transient failure.
      const prev = useAuthStore.getState()
      const prevRole = prev.role
      const hadToken = !!prev.token

      if (!hadToken) setStatus('loading')
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
              applyAuth(result.access_token, result.role, prevRole)
              return
            } catch (verifyErr) {
              // DEV escape hatch only — never in prod, where this would be an auth bypass.
              if (import.meta.env.DEV && tgUserId) {
                try {
                  const result = await loginByTgId({ id: tgUserId })
                  applyAuth(result.access_token, result.role, prevRole)
                  return
                } catch (loginErr) {
                  console.warn('[auth] /auth/login dev-fallback failed', loginErr)
                }
              } else {
                console.warn('[auth] /auth/tma-verify failed', verifyErr)
              }
              // 401 → clear the stale session and re-verify once. Never surface
              // the raw token/HMAC/initData/JWT text — only a localized message.
              const { status: verifyStatus } = extractApiError(verifyErr)
              if (verifyStatus === 401 && attempt === 0) {
                useAuthStore.getState().logout()
                continue
              }
            }
          }
          // Re-verify didn't produce a session this open. If we already had a
          // valid cached token, keep it rather than logging the user out.
          if (hadToken) {
            setStatus('authenticated')
            return
          }
        }

        if (hadToken) {
          setStatus('authenticated')
          return
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
        return
      } catch (err) {
        const { status: errStatus, userMessage } = extractApiError(err)
        // A 401 here means the persisted token is invalid — clear it and re-run
        // the flow once so we re-verify from a clean slate (don't keep a dead
        // session just because token still exists in the store).
        if (errStatus === 401 && attempt === 0) {
          useAuthStore.getState().logout()
          continue
        }
        // Network/unexpected error: keep an existing session if we have one.
        if (useAuthStore.getState().token) {
          setStatus('authenticated')
          return
        }
        // Always a clean localized message — never raw token/HMAC/JWT/initData text.
        setStatus('error')
        setError(userMessage)
        return
      }
    }
  }, [setAuth])

  // Re-verify exactly once per app open. We intentionally run tma-verify even
  // when a cached token already exists, so a role change (e.g. promotion to
  // admin after being added to vliq.admin) is picked up without the user having
  // to clear the Mini App. The ref guard prevents a verify→setAuth→token-change
  // →effect loop and StrictMode's double-mount from re-firing it.
  const didInit = useRef(false)
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    // All state updates happen inside the async function, not directly in the
    // effect body, so the react-hooks/set-state-in-effect rule is satisfied.
    void (async () => {
      // Trust likely-TMA context too — doAuth will internally wait up to
      // 2.5s for initData to arrive (Android delay).
      if (isTmaEnvironment() || isLikelyTmaContext()) {
        await doAuth()
      } else if (token) {
        // Outside Telegram but a cached session exists (e.g. DEV mock login).
        setStatus('authenticated')
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
          // Localized fallback only — never the raw axios/JWT message.
          setStatus('error')
          setError(extractApiError(err).userMessage)
        }
      }
    : undefined

  return { status, error, mockLogin }
}
