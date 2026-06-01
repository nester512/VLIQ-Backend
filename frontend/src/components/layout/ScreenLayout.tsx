import type { ReactNode } from 'react'
import { useViewport } from '../../hooks/useViewport'

interface ScreenLayoutProps {
  /** Header area (TgHeader component) */
  header?: ReactNode
  /** Tab bar area (TabBar component) */
  tabBar?: ReactNode
  /** Main scrollable content */
  children: ReactNode
  /** Additional class for the scrollable body */
  className?: string
  /** Disable internal scrolling (used by the full-screen swipe deck) */
  noScroll?: boolean
}

// Header height includes the iOS safe-area-top inset added by TgHeader.
const HEADER_OFFSET = 'calc(50px + env(safe-area-inset-top, 0px))'
const TABBAR_H = 74

/**
 * ScreenLayout — base layout for every route.
 *
 * Mobile (< 768 px):
 *   ┌────────────────────┐
 *   │       Header       │  50 px
 *   ├────────────────────┤
 *   │     Scrollable     │  fills
 *   │       body         │
 *   ├────────────────────┤
 *   │      TabBar        │  74 px + safe-area-inset-bottom
 *   └────────────────────┘
 *
 * Tablet / Desktop (≥ 768 px):
 *   ┌──────────────┬─────────────────────────────────┐
 *   │   Sidebar    │          Header                  │
 *   │   TabBar     ├─────────────────────────────────┤
 *   │  (vertical)  │        Scrollable body           │
 *   └──────────────┴─────────────────────────────────┘
 *
 * The body's `bottom` offset always sits above the tabbar safe-area so
 * that even `noScroll` content (the swipe deck) doesn't get clipped by
 * the bottom navigation.
 */
export function ScreenLayout({
  header,
  tabBar,
  children,
  className = '',
  noScroll = false,
}: ScreenLayoutProps) {
  const viewport = useViewport()
  const isWide = viewport === 'tablet' || viewport === 'desktop'

  // On mobile: tabbar is at bottom — offset body so content isn't hidden under it.
  // On wide: tabbar is sidebar — no bottom offset needed.
  const bottomOffset = (!isWide && tabBar)
    ? `calc(${TABBAR_H}px + env(safe-area-inset-bottom, 0px))`
    : '0px'

  // Scrollable bodies also leave breathing room before the tabbar so the
  // last list item / button isn't visually flush with the chrome.
  const extraScrollPad = noScroll
    ? 0
    : (!isWide && tabBar)
      ? 24
      : 30

  if (isWide && tabBar) {
    // Wide layout: sidebar + main content
    return (
      <div className="vliq-screen-wide">
        {/* Sidebar: vertical tabbar */}
        <aside className="vliq-sidebar">
          {tabBar}
        </aside>

        {/* Right panel: header + scrollable body */}
        <div className="vliq-main-panel">
          {header}
          <div
            className={[
              'absolute left-0 right-0',
              noScroll ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden no-scrollbar',
              className,
            ].join(' ')}
            style={{
              top: HEADER_OFFSET,
              bottom: 0,
              paddingBottom: extraScrollPad,
            }}
          >
            {children}
          </div>
        </div>
      </div>
    )
  }

  // Mobile layout: header top, tabbar bottom
  return (
    <>
      {header}

      <div
        className={[
          'absolute left-0 right-0',
          noScroll ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden no-scrollbar',
          className,
        ].join(' ')}
        style={{
          top: HEADER_OFFSET,
          bottom: bottomOffset,
          paddingBottom: extraScrollPad,
        }}
      >
        {children}
      </div>

      {tabBar}
    </>
  )
}
