import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useUiStore } from '@/store/uiStore'
import { listNotifications } from '@/api/notifications'
import { useAuthStore } from '@/store/authStore'

interface TgHeaderProps {
  title: string
  subtitle?: string
  onBack?: () => void
  rightAction?: ReactNode
  /** When true, show a placeholder instead of back button (home screen) */
  isHome?: boolean
  /** When true, show bell icon in the right action area */
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

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

/**
 * TgHeader — matches the Telegram Web App header style from the prototype.
 *
 * Layout: [back/placeholder] [title+subtitle centered] [right-action/placeholder]
 * Uses stable CSS classes from index.css instead of Tailwind arbitrary values.
 */
export function TgHeader({
  title,
  subtitle,
  onBack,
  rightAction,
  isHome = false,
  showBell = false,
}: TgHeaderProps) {
  const openSheet = useUiStore((s) => s.openSheet)
  const token = useAuthStore((s) => s.token)

  // Lightweight poll for the unread badge — `select` keeps only the count in
  // memory so component re-renders are stable across notification list changes.
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => listNotifications(),
    enabled: showBell && Boolean(token),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    select: (items) => items.filter((n) => !n.read).length,
  })
  const hasUnread = unreadCount > 0

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

      {/* Right: action or bell or spacer */}
      {rightAction ? (
        <div className="vliq-hbtn">{rightAction}</div>
      ) : showBell ? (
        <button
          type="button"
          onClick={() => openSheet('notif')}
          aria-label={hasUnread ? `Уведомления, ${unreadCount} новых` : 'Уведомления'}
          className="vliq-hbtn"
          style={{ position: 'relative' }}
        >
          <BellIcon />
          {hasUnread && (
            <span
              aria-hidden
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: 'var(--vliq-dg-ink)',
                border: '2px solid var(--vliq-card)',
                boxSizing: 'content-box',
              }}
            />
          )}
        </button>
      ) : (
        <div className="vliq-hbtn" aria-hidden />
      )}
    </header>
  )
}
