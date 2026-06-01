import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from "../../store/authStore"
import { useAuthFlow } from './useAuthFlow'
import { Spinner } from "../../components/atoms/Spinner"
import { Btn } from "../../components/atoms/Btn"

interface AuthGateProps {
  children: ReactNode
}

/**
 * AuthGate — guards all routes behind authentication.
 *
 * - No token → runs useAuthFlow (TMA init or dev mock)
 * - Loading → shows full-screen loader
 * - Error → shows error message (+ mock login btn in DEV)
 * - Authenticated → renders children, redirects by role
 */
export function AuthGate({ children }: AuthGateProps) {
  const { token, role } = useAuthStore()
  const { status, error, mockLogin } = useAuthFlow()

  // Already authenticated — redirect by role from /
  if (token && role) {
    return <>{children}</>
  }

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-dvh gap-4 bg-[var(--vliq-bg)]">
        <h1 className="text-2xl font-extrabold text-[var(--vliq-text)] tracking-tight">VLIQ</h1>
        <Spinner size={36} className="text-[var(--vliq-brand)]" />
        <p className="text-sm text-[var(--vliq-hint)]">Авторизация…</p>
      </div>
    )
  }

  if (status === 'error') {
    // The "outside Telegram" branch is hit when the URL is opened in a
    // regular browser tab (forwarded link, history, manual paste) instead of
    // via the bot's Menu Button. Give the user a one-tap path back to the bot
    // via the `tg://` deep-link scheme instead of a dead "try again" loop.
    const isNotInTelegram = !!error && error.includes('доступно только через Telegram')
    const botUsername = (import.meta.env.VITE_TG_BOT_USERNAME as string | undefined) ?? 'Vladiglobbot'

    // Open the bot. The `tg://` scheme is sandboxed away inside Telegram's own
    // WebView (which is exactly where this error often fires on broken launches),
    // so we route through Telegram.WebApp.openTelegramLink when available.
    // Outside Telegram, t.me link works on all platforms.
    const handleOpenBot = () => {
      const tgApp = (window as Window & {
        Telegram?: { WebApp?: { openTelegramLink?: (u: string) => void } }
      }).Telegram?.WebApp
      const tmeUrl = `https://t.me/${botUsername}`
      if (tgApp?.openTelegramLink) {
        tgApp.openTelegramLink(tmeUrl)
      } else {
        window.open(tmeUrl, '_blank', 'noopener')
      }
    }

    return (
      <div className="flex flex-col items-center justify-center h-dvh gap-4 px-8 bg-[var(--vliq-bg)] text-center">
        <h1 className="text-2xl font-extrabold text-[var(--vliq-text)] tracking-tight">VLIQ</h1>
        <div className="text-4xl">{isNotInTelegram ? '💬' : '⚠️'}</div>
        <p className="text-base font-semibold text-[var(--vliq-text)]">
          {error ?? 'Ошибка авторизации'}
        </p>
        {isNotInTelegram && (
          <p className="text-[13px] text-[var(--vliq-hint)] max-w-xs">
            Открой @{botUsername} в Telegram и нажми кнопку меню «Открыть VLIQ».
          </p>
        )}
        <div className="w-full max-w-xs mt-2 flex flex-col gap-2">
          {isNotInTelegram && (
            <Btn onClick={handleOpenBot}>Открыть @{botUsername} в Telegram</Btn>
          )}
          <Btn
            variant={isNotInTelegram ? 'ghost' : 'primary'}
            onClick={() => window.location.reload()}
          >
            Попробовать снова
          </Btn>
          {import.meta.env.DEV && mockLogin && (
            <Btn variant="ghost" onClick={() => { void mockLogin() }}>
              Mock Login (DEV)
            </Btn>
          )}
        </div>
      </div>
    )
  }

  // idle + DEV mode: show mock login button
  if (status === 'idle' && import.meta.env.DEV && mockLogin) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh gap-6 px-8 bg-[var(--vliq-bg)] text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-extrabold text-[var(--vliq-text)]">VLIQ</h1>
          <p className="text-sm text-[var(--vliq-hint)]">
            Локальная разработка · Авторизация через Telegram недоступна
          </p>
        </div>
        <div className="w-full max-w-xs">
          <Btn onClick={() => { void mockLogin() }}>
            🔑 Mock Login (DEV)
          </Btn>
        </div>
        <p className="text-xs text-[var(--vliq-hint)]">
          Используется telegram_id=12345. Убедитесь что пользователь есть в БД.
        </p>
      </div>
    )
  }

  // Fallback: spinner while idle (should not normally happen)
  return (
    <div className="flex items-center justify-center h-dvh bg-[var(--vliq-bg)]">
      <Spinner size={36} className="text-[var(--vliq-brand)]" />
    </div>
  )
}

/**
 * RoleRedirect — redirects authenticated user to their home screen.
 * Use at the `/` route.
 */
export function RoleRedirect() {
  const { role } = useAuthStore()

  if (role === 'seller') {
    return <Navigate to="/seller/home" replace />
  }
  if (role === 'admin' || role === 'super_admin') {
    return <Navigate to="/admin/dash" replace />
  }

  return <Navigate to="/" replace />
}
