import type { ReactNode } from 'react'

interface TgHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  rightAction?: ReactNode
  /** When true, show a placeholder instead of back button (home screen) */
  isHome?: boolean
  /** @deprecated In-app notifications are out of scope (spec S7: Telegram-only).
   *  Kept for call-site compatibility; no bell is rendered. */
  showBell?: boolean
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden>
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}

/**
 * TgHeader — matches the Telegram Web App header style from the prototype.
 *
 * Layout: [back/placeholder] [title+subtitle centered] [right-action/placeholder]
 *
 * Notifications are delivered only via Telegram DM (spec S7 / Out-of-scope:
 * «центр уведомлений внутри приложения не нужен»), so there is no in-app bell.
 */
export function TgHeader({
  title,
  subtitle,
  onBack,
  rightAction,
  isHome = false,
}: TgHeaderProps) {
  return (
    <header
      className="vliq-tg-header"
      style={{
        // Grows with the iOS notch/Dynamic Island safe area so the title
        // doesn't sit under the system bar inside Telegram for iPhone.
        height: 'calc(50px + env(safe-area-inset-top, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Left: back button or spacer */}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Назад"
          className="vliq-hbtn"
        >
          <BackIcon />
        </button>
      ) : (
        <div
          className="vliq-hbtn"
          style={{ visibility: isHome ? 'hidden' : 'visible' }}
          aria-hidden
        />
      )}

      {/* Center: title + subtitle — truncates with ellipsis if too long */}
      <div className="vliq-tg-header__center">
        <div className="vliq-tg-header__title">{title}</div>
        {subtitle && (
          <div className="vliq-tg-header__subtitle">{subtitle}</div>
        )}
      </div>

      {/* Right: optional action or spacer (no in-app notifications bell) */}
      {rightAction ? (
        <div className="vliq-hbtn">{rightAction}</div>
      ) : (
        <div className="vliq-hbtn" aria-hidden />
      )}
    </header>
  )
}
