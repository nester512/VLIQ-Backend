import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import {
  mountBackButton, unmountBackButton, showBackButton, hideBackButton,
  onBackButtonClick, offBackButtonClick, isBackButtonMounted,
} from '@telegram-apps/sdk-react'
import { useAuthStore } from '../store/authStore'
import { ScreenLayout } from '../components/layout/ScreenLayout'
import { TgHeader } from '../components/organisms/TgHeader'
import { TabBar } from '../components/organisms/TabBar'
import { RoleRedirect } from '../features/auth/AuthGate'
import { isTmaEnvironment } from '../utils/tma'
import { getMe } from '../api/sellers'
import { Spinner } from '../components/atoms/Spinner'
import { useViewport } from '../hooks/useViewport'

/**
 * Wires the Telegram native BackButton to navigate(-1) on subpages.
 * On tab/home pages — hides it.
 */
function useTelegramBack(isHome: boolean) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!isTmaEnvironment()) return
    try { if (!isBackButtonMounted()) mountBackButton() } catch { /* not in TMA */ }

    if (isHome) {
      try { hideBackButton() } catch { /* */ }
      return
    }

    const handler = () => navigate(-1)
    try {
      showBackButton()
      onBackButtonClick(handler)
    } catch { /* */ }

    return () => {
      try {
        offBackButtonClick(handler)
        hideBackButton()
      } catch { /* */ }
    }
  }, [isHome, navigate])

  useEffect(() => {
    return () => {
      try { unmountBackButton() } catch { /* */ }
    }
  }, [])
}

// Seller pages — HomePage is eager (initial route, must be instant).
// The rest are lazy so the main bundle stays small; they load on first visit.
import { HomePage } from '../features/seller/pages/HomePage'
const RegPage     = lazy(() => import('../features/seller/pages/RegPage').then((m) => ({ default: m.RegPage })))
const UploadPage  = lazy(() => import('../features/seller/pages/UploadPage').then((m) => ({ default: m.UploadPage })))
const StatusPage  = lazy(() => import('../features/seller/pages/StatusPage').then((m) => ({ default: m.StatusPage })))
const BalancePage = lazy(() => import('../features/seller/pages/BalancePage').then((m) => ({ default: m.BalancePage })))
const HistoryPage = lazy(() => import('../features/seller/pages/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const PromoPage   = lazy(() => import('../features/seller/pages/PromoPage').then((m) => ({ default: m.PromoPage })))
const ProfilePage = lazy(() => import('../features/seller/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const PayoutPage  = lazy(() => import('../features/seller/pages/PayoutPage').then((m) => ({ default: m.PayoutPage })))
const PayoutRequestsPage = lazy(() => import('../features/seller/pages/PayoutRequestsPage').then((m) => ({ default: m.PayoutRequestsPage })))
const PersonalDataConsentPage = lazy(() => import('../features/seller/pages/PersonalDataConsentPage').then((m) => ({ default: m.PersonalDataConsentPage })))
const OfferPlaceholderPage = lazy(() => import('../features/seller/pages/OfferPlaceholderPage').then((m) => ({ default: m.OfferPlaceholderPage })))

// Admin pages — lazy so sellers (the 95% case) never download the admin
// bundle (review queue, framer-motion deck, etc.).
const DashPage            = lazy(() => import('../features/admin/pages/DashPage').then((m) => ({ default: m.DashPage })))
const ReviewPage          = lazy(() => import('../features/admin/pages/ReviewPage').then((m) => ({ default: m.ReviewPage })))
const PayoutsPage         = lazy(() => import('../features/admin/pages/PayoutsPage').then((m) => ({ default: m.PayoutsPage })))
const SellersPage         = lazy(() => import('../features/admin/pages/SellersPage').then((m) => ({ default: m.SellersPage })))
const SellerReceiptsPage  = lazy(() => import('../features/admin/pages/SellerReceiptsPage').then((m) => ({ default: m.SellerReceiptsPage })))
const AdminReceiptsPage   = lazy(() => import('../features/admin/pages/AdminReceiptsPage').then((m) => ({ default: m.AdminReceiptsPage })))
const ProductsPage        = lazy(() => import('../features/admin/pages/ProductsPage').then((m) => ({ default: m.ProductsPage })))

// Crossfade — used for tab switches where there's no logical push/pop direction.
const PAGE_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
}
const PAGE_TRANSITION = { duration: 0.18, ease: 'easeOut' as const }

// `fill` (h-full) is only for full-screen no-scroll pages (the review deck),
// which need a definite-height parent. Scrolling pages use `min-h-full` so the
// wrapper GROWS with its content instead of overflowing its fixed-height box —
// otherwise long lists bleed past the scroll container's bottom padding and the
// last row sits flush against the tab bar.
function AnimatedPage({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  return (
    <motion.div
      className={`${fill ? 'h-full' : 'min-h-full'} w-full`}
      variants={PAGE_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={PAGE_TRANSITION}
    >
      {children}
    </motion.div>
  )
}

const SELLER_TITLES: Record<string, [string, string?, boolean?, boolean?]> = {
  // [title, subtitle?, isHome?, showBell?]
  '/seller/home':    ['VLIQ', undefined, true, true],
  '/seller/reg':     ['Регистрация', undefined, true, false],
  '/seller/privacy': ['Согласие', undefined, false, false],
  '/seller/offer/1': ['Оферта №1', undefined, false, false],
  '/seller/offer/2': ['Оферта №2', undefined, false, false],
  '/seller/upload':  ['Загрузить чек', undefined, false, true],
  '/seller/balance': ['Мой баланс', undefined, false, true],
  '/seller/history': ['История чеков', undefined, false, true],
  '/seller/promo':   ['Акции', undefined, false, true],
  '/seller/profile': ['Профиль', undefined, false, true],
  '/seller/payout':  ['Запросить выплату', undefined, false, false],
  '/seller/payouts': ['Мои заявки', undefined, false, false],
}

function SellerHeader() {
  const location = useLocation()
  const navigate = useNavigate()
  const isStatus = location.pathname.startsWith('/seller/status/')
  const entry = SELLER_TITLES[location.pathname]
  const [title, subtitle, isHome, showBell] = isStatus
    ? ['Чек', undefined, false, false]
    : (entry ?? ['VLIQ', undefined, true, true])
  // Inside Telegram, the system BackButton is the primary back affordance —
  // hide the in-app one so we don't duplicate it.
  const inTma = isTmaEnvironment()
  const showInAppBack = !isHome && !inTma
  return (
    <TgHeader
      title={title}
      subtitle={subtitle}
      isHome={isHome}
      showBell={showBell}
      onBack={showInAppBack ? () => navigate(-1) : undefined}
    />
  )
}

// The 4 primary seller tabs — these hide the back affordance (top-level). Every
// OTHER seller page (upload/status/balance/payout/payouts) is a subpage: it
// shows the back button AND keeps the bottom tabbar so navigation + correct
// bottom spacing are always present. Only the forced registration screen has no
// tabbar (the profile gate makes it a mandatory full-screen flow).
const SELLER_MAIN_TABS = ['/seller/home', '/seller/history', '/seller/promo', '/seller/profile']

/**
 * Seller profile gate — once a seller is auto-created on first TMA login, the
 * backend stores them as `status='pending'`. We force the registration flow
 * until they save their real phone/store/payout details, at which point the
 * status flips to `active` server-side and they can use the app.
 */
function SellerProfileGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()

  // `retry: false` so a stale-token 401 doesn't fire 3× and trigger 3× logouts
  // via the axios interceptor.
  const { data: profile, isLoading } = useQuery({
    queryKey: ['sellers', 'me'],
    queryFn: getMe,
    staleTime: 60_000,
    retry: false,
  })

  const isPending = profile?.status === 'pending'
  // Offer placeholders are part of the mandatory registration flow and must
  // stay reachable while the profile is still pending.
  const onRegistrationFlow = location.pathname === '/seller/reg' || location.pathname === '/seller/privacy' || /^\/seller\/offer\/[12]$/.test(location.pathname)

  useEffect(() => {
    if (isPending && !onRegistrationFlow) navigate('/seller/reg', { replace: true })
  }, [isPending, onRegistrationFlow, navigate])

  if (isLoading && !profile) {
    return (
      <div className="grid place-items-center h-full">
        <Spinner size={32} className="text-[var(--vliq-brand)]" />
      </div>
    )
  }
  return <>{children}</>
}

function SellerLayout() {
  const location = useLocation()
  const isReg = location.pathname === '/seller/reg'
  const isMainTab = SELLER_MAIN_TABS.includes(location.pathname)
  // Tabbar on every page except the forced registration flow.
  const showTabBar = !isReg
  const viewport = useViewport()
  const isWide = viewport === 'tablet' || viewport === 'desktop'
  // Telegram native BackButton: hidden on main tabs + reg, shown on subpages.
  useTelegramBack(isMainTab || isReg)
  return (
    <ScreenLayout
      header={<SellerHeader />}
      tabBar={showTabBar ? <TabBar mode="seller" orientation={isWide ? 'vertical' : 'horizontal'} /> : undefined}
    >
      <SellerProfileGate>
        <AnimatePresence mode="wait">
          <Suspense
            fallback={
              <div className="grid place-items-center h-full">
                <Spinner size={32} className="text-[var(--vliq-brand)]" />
              </div>
            }
          >
            <Routes location={location} key={location.pathname}>
              <Route path="home"        element={<AnimatedPage><HomePage /></AnimatedPage>} />
              <Route path="reg"         element={<AnimatedPage><RegPage /></AnimatedPage>} />
              <Route path="privacy"     element={<AnimatedPage><PersonalDataConsentPage /></AnimatedPage>} />
              <Route path="offer/:offerId" element={<AnimatedPage><OfferPlaceholderPage /></AnimatedPage>} />
              <Route path="upload"      element={<AnimatedPage><UploadPage /></AnimatedPage>} />
              <Route path="status/:id"  element={<AnimatedPage><StatusPage /></AnimatedPage>} />
              <Route path="balance"     element={<AnimatedPage><BalancePage /></AnimatedPage>} />
              <Route path="history"     element={<AnimatedPage><HistoryPage /></AnimatedPage>} />
              <Route path="promo"       element={<AnimatedPage><PromoPage /></AnimatedPage>} />
              <Route path="profile"     element={<AnimatedPage><ProfilePage /></AnimatedPage>} />
              <Route path="payout"      element={<AnimatedPage><PayoutPage /></AnimatedPage>} />
              <Route path="payouts"     element={<AnimatedPage><PayoutRequestsPage /></AnimatedPage>} />
              <Route index element={<Navigate to="home" replace />} />
            </Routes>
          </Suspense>
        </AnimatePresence>
      </SellerProfileGate>
    </ScreenLayout>
  )
}

function AdminLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const isReview = location.pathname === '/admin/review'
  const isReceiptArchive = location.pathname === '/admin/receipts'
  const isProducts = location.pathname === '/admin/products'
  const isSellerReceipts = /^\/admin\/sellers\/\d+\/receipts$/.test(location.pathname)
  const viewport = useViewport()
  const isWide = viewport === 'tablet' || viewport === 'desktop'
  const inTma = isTmaEnvironment()
  // On the seller-receipts sub-page use a back affordance; all other admin pages are "home" tabs.
  useTelegramBack(!isSellerReceipts)

  return (
    <ScreenLayout
      header={
        isSellerReceipts ? (
          <TgHeader
            title="Чеки продавца"
            isHome={false}
            onBack={!inTma ? () => navigate(-1) : undefined}
          />
        ) : (
          <TgHeader
            title={isReview ? 'Проверка чеков' : isReceiptArchive ? 'Все чеки' : isProducts ? 'Товары' : 'Администратор'}
            subtitle={isReview || isReceiptArchive || isProducts ? undefined : 'VLIQ · бренд'}
            isHome
          />
        )
      }
      tabBar={<TabBar mode="admin" orientation={isWide ? 'vertical' : 'horizontal'} />}
      noScroll={isReview}
    >
      <AnimatePresence mode="wait">
        <Suspense
          fallback={
            <div className="grid place-items-center h-full">
              <Spinner size={32} className="text-[var(--vliq-brand)]" />
            </div>
          }
        >
          <Routes location={location} key={location.pathname}>
            <Route path="dash"                              element={<AnimatedPage><DashPage /></AnimatedPage>} />
            <Route path="review"                            element={<AnimatedPage fill><ReviewPage /></AnimatedPage>} />
            <Route path="receipts"                          element={<AnimatedPage><AdminReceiptsPage /></AnimatedPage>} />
            <Route path="payouts"                           element={<AnimatedPage><PayoutsPage /></AnimatedPage>} />
            <Route path="sellers"                           element={<AnimatedPage><SellersPage /></AnimatedPage>} />
            <Route path="sellers/:telegramId/receipts"      element={<AnimatedPage><SellerReceiptsPage /></AnimatedPage>} />
            <Route path="products"                          element={<AnimatedPage><ProductsPage /></AnimatedPage>} />
            <Route index element={<Navigate to="dash" replace />} />
          </Routes>
        </Suspense>
      </AnimatePresence>
    </ScreenLayout>
  )
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token } = useAuthStore()
  if (!token) return <Navigate to="/" replace />
  return <>{children}</>
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RoleRedirect />} />
      <Route
        path="/seller/*"
        element={
          <ProtectedRoute>
            <SellerLayout />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
