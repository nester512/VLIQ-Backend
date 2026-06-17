import { NavLink } from 'react-router-dom'

interface TabItem {
  path: string
  label: string
  icon: string // SVG path content
}

// SVG content for each icon (from prototype const I = {...})
const SELLER_TABS: TabItem[] = [
  {
    path: '/seller/home',
    label: 'Главная',
    icon: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/>',
  },
  {
    path: '/seller/history',
    label: 'Чеки',
    icon: '<path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  },
  {
    path: '/seller/promo',
    label: 'Акции',
    icon: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M3 13h18M12 9v12"/><path d="M12 9C12 9 9.5 3 7 5s2 4 5 4 7.5-1 5-4-5 4-5 4"/>',
  },
  {
    path: '/seller/profile',
    label: 'Профиль',
    icon: '<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
  },
]

const ADMIN_TABS: TabItem[] = [
  {
    path: '/admin/dash',
    label: 'Обзор',
    icon: '<path d="M4 4v16h16"/><path d="M7 14l3.5-4 3 2.5L20 6"/>',
  },
  {
    path: '/admin/review',
    label: 'Чеки',
    icon: '<path d="M5 3v18l2-1.5L9 21l2-1.5L13 21l2-1.5L17 21l2-1.5V3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  },
  {
    path: '/admin/payouts',
    label: 'Выплаты',
    icon: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/>',
  },
  {
    path: '/admin/sellers',
    label: 'Продавцы',
    icon: '<circle cx="9" cy="8" r="3.5"/><path d="M3 21a6 6 0 0 1 12 0"/><path d="M16 5.6a3.5 3.5 0 0 1 0 6.8M21 21a6 6 0 0 0-5-5.9"/>',
  },
  {
    path: '/admin/products',
    label: 'Товары',
    icon: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
  },
]

interface TabBarProps {
  mode: 'seller' | 'admin'
  /**
   * orientation — 'horizontal' (default, bottom bar) or 'vertical' (sidebar).
   * Visual style for mobile is NEVER changed; the vertical variant is CSS-only
   * and applies only on tablet/desktop via the `vliq-tabbar--vertical` class.
   */
  orientation?: 'horizontal' | 'vertical'
}

function TabIcon({ svgContent }: { svgContent: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="23"
      height="23"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      // Safe: content is from our controlled SELLER_TABS/ADMIN_TABS constants
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  )
}

/**
 * Tab navigation bar.
 * Supports seller (4 tabs) and admin (4 tabs) modes.
 * On mobile: bottom bar (position absolute, horizontal).
 * On tablet/desktop: pass orientation="vertical" to render as a sidebar.
 */
export function TabBar({ mode, orientation = 'horizontal' }: TabBarProps) {
  const tabs = mode === 'seller' ? SELLER_TABS : ADMIN_TABS
  const isVertical = orientation === 'vertical'

  return (
    <nav
      aria-label={mode === 'seller' ? 'Навигация продавца' : 'Навигация администратора'}
      className={[
        'vliq-tabbar',
        isVertical ? 'vliq-tabbar--vertical' : 'vliq-tabbar--bottom',
      ].join(' ')}
      style={isVertical ? undefined : {
        // Height grows with the iPhone home-indicator safe area so the icons
        // stay above the gesture zone; the scroll body padding in
        // ScreenLayout matches this so the last list item doesn't sit under
        // the tabbar.
        height: 'calc(74px + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          className="vliq-tab"
        >
          {({ isActive }) => (
            <span
              aria-current={isActive ? 'page' : undefined}
              style={{ color: isActive ? 'var(--vliq-brand)' : 'var(--vliq-hint)' }}
            >
              <TabIcon svgContent={tab.icon} />
              <span className="vliq-tab__label">{tab.label}</span>
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
