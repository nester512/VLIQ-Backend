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

// Admin pages — lazy so sellers (the 95% case) never download the admin
// bundle (review queue, framer-motion deck, etc.).
const DashPage            = lazy(() => import('../features/admin/pages/DashPage').then((m) => ({ default: m.DashPage })))
const ReviewPage          = lazy(() => import('../features/admin/pages/ReviewPage').then((m) => ({ default: m.ReviewPage })))
const PayoutsPage         = lazy(() => import('../features/admin/pages/PayoutsPage').then((m) => ({ default: m.PayoutsPage })))
const SellersPage         = lazy(() => import('../features/admin/pages/SellersPage').then((m) => ({ default: m.SellersPage })))
const SellerReceiptsPage  = lazy(() => import('../features/admin/pages/SellerReceiptsPage').then((m) => ({ default: m.SellerReceiptsPage })))

// Crossfade — used for tab switches where there's no logical push/pop direction.
const PAGE_VARIANTS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
}
const PAGE_TRANSITION = { duration: 0.18, ease: 'easeOut' as const }

function AnimatedPage({ children }: { children: ReactNode }) {
  return (
    <motion.div
      className="h-full w-full"
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
  '/seller/upload':  ['Загрузить чек', undefined, false, true],
  '/seller/balance': ['Мой баланс', undefined, false, true],
  '/seller/history': ['История чеков', undefined, false, true],
  '/seller/promo':   ['Акции', undefined, false, true],
  '/seller/profile': ['Профиль', undefined, false, true],
  '/seller/payout':  ['Запросить выплату', undefined, false, false],
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

const SELLER_TAB_ROUTES = ['/seller/home', '/seller/history', '/seller/promo', '/seller/profile']

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
  const onRegPage = location.pathname === '/seller/reg'

  useEffect(() => {
    if (isPending && !onRegPage) navigate('/seller/reg', { replace: true })
  }, [isPending, onRegPage, navigate])

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
  const showTabBar = SELLER_TAB_ROUTES.includes(location.pathname)
  const viewport = useViewport()
  const isWide = viewport === 'tablet' || viewport === 'desktop'
  // Telegram native BackButton: shown on subpages, hidden on tab routes.
  useTelegramBack(showTabBar)
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
              <Route path="upload"      element={<AnimatedPage><UploadPage /></AnimatedPage>} />
              <Route path="status/:id"  element={<AnimatedPage><StatusPage /></AnimatedPage>} />
              <Route path="balance"     element={<AnimatedPage><BalancePage /></AnimatedPage>} />
              <Route path="history"     element={<AnimatedPage><HistoryPage /></AnimatedPage>} />
              <Route path="promo"       element={<AnimatedPage><PromoPage /></AnimatedPage>} />
              <Route path="profile"     element={<AnimatedPage><ProfilePage /></AnimatedPage>} />
              <Route path="payout"      element={<AnimatedPage><PayoutPage /></AnimatedPage>} />
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
            title={isReview ? 'Проверка чеков' : 'Администратор'}
            subtitle={isReview ? undefined : 'VLIQ · бренд'}
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
            <Route path="review"                            element={<AnimatedPage><ReviewPage /></AnimatedPage>} />
            <Route path="payouts"                           element={<AnimatedPage><PayoutsPage /></AnimatedPage>} />
            <Route path="sellers"                           element={<AnimatedPage><SellersPage /></AnimatedPage>} />
            <Route path="sellers/:telegramId/receipts"      element={<AnimatedPage><SellerReceiptsPage /></AnimatedPage>} />
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
