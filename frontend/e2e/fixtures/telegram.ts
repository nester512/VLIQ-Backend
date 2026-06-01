/**
 * Telegram WebApp mock fixture.
 *
 * The real Telegram client injects window.Telegram.WebApp via
 * https://telegram.org/js/telegram-web-app.js and populates
 * `initData` with a HMAC-signed query string.
 *
 * In E2E tests we have no real Telegram client, so we:
 *   1. Inject the window.Telegram stub via page.addInitScript (runs before ANY
 *      other script, including the real SDK loaded from the <script> tag).
 *   2. Use a non-empty initData so isTmaEnvironment() returns true.
 *   3. The actual HMAC cannot be valid without the real bot token, so the
 *      backend's /auth/tma-verify will 4xx. Tests must either:
 *      a) Mock the network (route intercept), or
 *      b) Rely on the DEV-mode fallback in useAuthFlow → /auth/login, or
 *      c) Pre-seed authStore via localStorage before navigation (fastest).
 *
 * This file exports:
 *   - MOCK_USER        — default user object
 *   - MOCK_SELLER_JWT  — dummy (syntactically-valid, unsigned) JWT for seller role
 *   - MOCK_ADMIN_JWT   — dummy (syntactically-valid, unsigned) JWT for admin role
 *   - mockTelegramInitData(page, user?) — injects the mock before page load
 *   - injectAuthToken(page, token, role) — pre-seeds authStore in localStorage
 *   - mockSellerApi(page, opts)  — registers page.route() mocks for seller endpoints
 *   - mockAdminApi(page, opts)   — registers page.route() mocks for admin endpoints
 *   - test             — extended Playwright test with `telegramUser` fixture
 */

import { test as base, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  photo_url?: string
  language_code?: string
}

// ---------------------------------------------------------------------------
// Default mock user (matches local seed_dev.sql telegram_id=12345)
// ---------------------------------------------------------------------------

export const MOCK_USER: TelegramUser = {
  id: 12345,
  first_name: 'Test',
  last_name: 'Seller',
  username: 'test_seller',
  language_code: 'ru',
}

// ---------------------------------------------------------------------------
// Dummy JWTs — syntactically valid (header.payload.signature) but unsigned.
// The frontend only stores the token string; it never verifies the signature
// client-side (see authStore.ts + client.ts — token is passed as Bearer header).
// Format: base64url({"alg":"none"}).base64url(payload).dummysig
// ---------------------------------------------------------------------------

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function makeDummyJwt(sub: string, role: string): string {
  const header = b64url({ alg: 'none', typ: 'JWT' })
  const payload = b64url({
    sub,
    role,
    telegram_id: 12345,
    brand_id: 1,
    iat: 1700000000,
    exp: 9999999999,
  })
  // Signature is intentionally fake — backend will reject it, but the
  // frontend's axios interceptor only reacts to a 401 response, not the
  // token content. Pre-seeding localStorage bypasses auth flow entirely.
  return `${header}.${payload}.e2e_dummy_sig`
}

export const MOCK_SELLER_JWT: string      = makeDummyJwt('12345', 'seller')
export const MOCK_ADMIN_JWT: string       = makeDummyJwt('99999', 'admin')
export const MOCK_SUPER_ADMIN_JWT: string = makeDummyJwt('88888', 'super_admin')

// ---------------------------------------------------------------------------
// Build a plausible (but HMAC-invalid) initData string
// ---------------------------------------------------------------------------

function buildInitData(user: TelegramUser): string {
  const userJson = JSON.stringify(user)
  const authDate = Math.floor(Date.now() / 1000)
  const params = new URLSearchParams({
    user: userJson,
    auth_date: String(authDate),
    // Fake hash — server will reject it, but isTmaEnvironment() only checks length > 0
    hash: 'e2etesthash0000000000000000000000000000000000000000000000000000',
  })
  return params.toString()
}

// ---------------------------------------------------------------------------
// Core helper: inject mock BEFORE any page script runs
// ---------------------------------------------------------------------------

export async function mockTelegramInitData(
  page: Page,
  user: TelegramUser = MOCK_USER,
): Promise<void> {
  const initData = buildInitData(user)
  const initDataUnsafe = { user, auth_date: Math.floor(Date.now() / 1000) }

  await page.addInitScript(
    ({ initData, initDataUnsafe }: { initData: string; initDataUnsafe: unknown }) => {
      // Override window.Telegram.WebApp completely before the real SDK boots.
      // The SDK <script> tag runs after addInitScript scripts, so our stub takes
      // precedence (the SDK will overwrite later, but by then React has already
      // called isTmaEnvironment which reads the value set in this script because
      // React code runs after DOMContentLoaded / module evaluation).
      //
      // NOTE: The real telegram-web-app.js overwrites window.Telegram. To ensure
      // our stub persists we define a getter that always returns our stub.
      const stub = {
        initData,
        initDataUnsafe,
        colorScheme: 'light' as const,
        themeParams: {},
        ready: () => {},
        expand: () => {},
        close: () => {},
        onEvent: () => {},
        offEvent: () => {},
        BackButton: {
          isVisible: false,
          show: () => {},
          hide: () => {},
          onClick: () => {},
          offClick: () => {},
        },
        MainButton: {
          isVisible: false,
          text: '',
          show: () => {},
          hide: () => {},
          onClick: () => {},
          offClick: () => {},
        },
        HapticFeedback: {
          impactOccurred: () => {},
          notificationOccurred: () => {},
          selectionChanged: () => {},
        },
        version: '6.9',
        platform: 'web',
        isExpanded: true,
        viewportHeight: 844,
        viewportStableHeight: 844,
        headerColor: '#ffffff',
        backgroundColor: '#ffffff',
        isClosingConfirmationEnabled: false,
        enableClosingConfirmation: () => {},
        disableClosingConfirmation: () => {},
        setHeaderColor: () => {},
        setBackgroundColor: () => {},
        showPopup: () => {},
        showAlert: () => {},
        showConfirm: () => {},
        openLink: () => {},
        openTelegramLink: () => {},
        openInvoice: () => {},
        sendData: () => {},
        switchInlineQuery: () => {},
        requestWriteAccess: () => {},
        requestContact: () => {},
      }

      try {
        Object.defineProperty(window, 'Telegram', {
          value: { WebApp: stub },
          writable: true,
          configurable: true,
        })
      } catch {
        // If already defined (e.g. real SDK loaded first somehow), force overwrite
        ;(window as Window & { Telegram?: unknown }).Telegram = { WebApp: stub }
      }
    },
    { initData, initDataUnsafe },
  )
}

// ---------------------------------------------------------------------------
// Pre-seed the Zustand authStore so tests skip the auth flow entirely
// ---------------------------------------------------------------------------

export async function injectAuthToken(
  page: Page,
  token: string,
  role: 'seller' | 'admin' | 'super_admin' = 'seller',
): Promise<void> {
  // Zustand persist key is 'vliq-auth' (see authStore.ts)
  await page.addInitScript(
    ({ token, role }: { token: string; role: string }) => {
      try {
        localStorage.setItem(
          'vliq-auth',
          JSON.stringify({ state: { token, role }, version: 0 }),
        )
      } catch {
        // localStorage may be blocked in some contexts
      }
    },
    { token, role },
  )
}

// ---------------------------------------------------------------------------
// Seller API mock options
// ---------------------------------------------------------------------------

export interface MockSellerApiOpts {
  /** Seller status — controls SellerProfileGate redirect behaviour. Default: 'active' */
  status?: 'pending' | 'active' | 'blocked'
  /** Available balance in kopecks. Default: 5000 (50.00 ₽) */
  available?: number
  /** Pending balance. Default: 0 */
  pending?: number
  /** Whether to include payout details (required for PayoutPage). Default: true */
  hasPayout?: boolean
  /** Mock upload response — defaults to 202 with receipt_id=42 */
  uploadReceiptId?: number
  /** Override the POST /receipts/upload response status. Default: 202 */
  uploadStatus?: number
  /** Override upload error body (when uploadStatus >= 400) */
  uploadError?: { code: string; user_message: string; debug_id: string }
  /** Mock QR payload response receipt_id. Default: 43 */
  qrReceiptId?: number
  /** Whether the notification bell should show an unread badge. Default: false */
  hasUnread?: boolean
  /** seller telegram_id — used in the mock response. Default: 12345 */
  telegramId?: number
}

/**
 * mockSellerApi — registers page.route() interceptors for all seller-facing
 * endpoints so tests run without a real backend. Call BEFORE page.goto().
 *
 * Signature: mockSellerApi(page, opts?)
 */
export async function mockSellerApi(
  page: Page,
  opts: MockSellerApiOpts = {},
): Promise<void> {
  const {
    status = 'active',
    available = 5000,
    pending = 0,
    hasPayout = true,
    uploadReceiptId = 42,
    uploadStatus = 202,
    uploadError,
    qrReceiptId = 43,
    hasUnread = false,
    telegramId = 12345,
  } = opts

  const sellerBody = {
    telegram_id: telegramId,
    brand_id: 1,
    phone_e164: '+79001234567',
    first_name: 'Тест',
    last_name: 'Продавец',
    city: 'Москва',
    outlet_name: 'Дымов · ТЦ Авиапарк',
    outlet_address: 'пр. Ленинградский, 1',
    outlet_chain: null,
    outlet_inn: null,
    position: 'Продавец-консультант',
    status,
    block_reason: null,
    payout_kind: hasPayout ? 'sbp_phone' : null,
    payout_masked: hasPayout ? '567' : null,
    consent_pdn_at: '2025-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: null,
  }

  const balanceBody = {
    available,
    on_hold: pending,
    total_accrued: available + 1000,
    total_paid_out: 0,
  }

  // GET / PATCH /sellers/me
  // After a successful PATCH (registration), subsequent GETs should return active.
  let sellerStatusOverride: string | null = null
  await page.route('**/api/v1/sellers/me', (route) => {
    if (route.request().method() === 'GET') {
      const currentStatus = sellerStatusOverride ?? status
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...sellerBody, status: currentStatus }),
      })
    } else {
      // PATCH /sellers/me — return active seller after registration
      // Also update the override so subsequent GETs return active
      sellerStatusOverride = 'active'
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...sellerBody, status: 'active' }),
      })
    }
  })

  // GET /sellers/me/balance
  await page.route('**/api/v1/sellers/me/balance', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(balanceBody),
    })
  })

  // GET /sellers/me/receipts
  await page.route('**/api/v1/sellers/me/receipts*', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, limit: 50, has_more: false }),
    })
  })

  // GET /notifications
  await page.route('**/api/v1/notifications*', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: hasUnread
          ? [
              {
                id: 1,
                seller_id: telegramId,
                type: 'receipt_approved',
                payload: { title: 'Чек одобрен', body: 'Бонус начислен' },
                read_at: null,
                created_at: new Date().toISOString(),
              },
            ]
          : [],
        total: hasUnread ? 1 : 0,
        page: 1,
        limit: 50,
        has_more: false,
      }),
    })
  })

  // GET /promotions
  await page.route('**/api/v1/promotions*', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { id: 1, title: 'Акция Весна', description: 'Купи 3 получи 4', starts_at: '2025-03-01T00:00:00Z', ends_at: '2025-06-01T00:00:00Z', bonus_percent: 10 },
          { id: 2, title: 'Акция Лето',  description: 'Скидка 20%',       starts_at: '2025-06-01T00:00:00Z', ends_at: '2025-09-01T00:00:00Z', bonus_percent: 20 },
          { id: 3, title: 'Акция Осень', description: 'Двойной бонус',    starts_at: '2025-09-01T00:00:00Z', ends_at: '2025-12-01T00:00:00Z', bonus_percent: 5  },
        ],
        total: 3,
        page: 1,
        limit: 50,
        has_more: false,
      }),
    })
  })

  // NOTE on route ordering: Playwright 1.60 uses LIFO (last-registered = first-matched).
  // We register catch-all routes FIRST so that more-specific routes registered later
  // take priority over them.

  // Catch-all for /receipts/* (GET only — detail page; seller normally uses /status endpoint)
  // Register FIRST so specific routes below override it.
  await page.route('**/api/v1/receipts/**', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: uploadReceiptId,
          seller_id: telegramId,
          status: 'pending',
          created_at: new Date().toISOString(),
        }),
      })
    } else {
      // Return 404 for unexpected POSTs (better than hanging on real server)
      void route.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"not found"}' })
    }
  })

  // GET /receipts/:id/status  (seller status poll endpoint)
  // Cycles pending → on_review → approved across 3 calls using a counter
  // stored in a closure.  Registered AFTER catch-all so LIFO puts it first.
  const statuses: Array<{ status: string }> = [
    { status: 'pending' },
    { status: 'on_review' },
    { status: 'approved' },
  ]
  let statusCallCount = 0
  await page.route('**/api/v1/receipts/*/status', (route) => {
    const s = statuses[Math.min(statusCallCount, statuses.length - 1)]
    statusCallCount++
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: uploadReceiptId,
        receipt_id: uploadReceiptId,
        status: s.status,
        bonus_amount: s.status === 'approved' ? 250 : undefined,
        rejection_reason: null,
      }),
    })
  })

  // POST /receipts/qr-payload — registered AFTER catch-all (LIFO = higher priority)
  await page.route('**/api/v1/receipts/qr-payload', (route) => {
    void route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ receipt_id: qrReceiptId }),
    })
  })

  // POST /receipts/upload — registered LAST (highest priority via LIFO)
  await page.route('**/api/v1/receipts/upload', (route) => {
    if (uploadStatus >= 400) {
      void route.fulfill({
        status: uploadStatus,
        contentType: 'application/json',
        body: JSON.stringify(
          uploadError ?? {
            code: 'RECEIPT_UNSUPPORTED_TYPE',
            user_message: 'Этот формат не поддерживается',
            debug_id: 'e2e-debug-001',
          },
        ),
      })
    } else {
      void route.fulfill({
        status: uploadStatus,
        contentType: 'application/json',
        body: JSON.stringify({ receipt_id: uploadReceiptId }),
      })
    }
  })

  // GET /bonus-transactions
  await page.route('**/api/v1/bonus-transactions*', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, limit: 50, has_more: false }),
    })
  })

  // POST /payout-requests  (seller requesting a payout)
  await page.route('**/api/v1/payout-requests', (route) => {
    if (route.request().method() === 'POST') {
      void route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 1,
          seller_id: telegramId,
          brand_id: 1,
          amount: available,
          payout_kind: 'sbp_phone',
          payout_masked: '567',
          status: 'new',
          admin_comment: null,
          created_at: new Date().toISOString(),
          updated_at: null,
        }),
      })
    } else {
      void route.continue()
    }
  })
}

// ---------------------------------------------------------------------------
// Admin API mock options
// ---------------------------------------------------------------------------

export interface MockAdminApiOpts {
  /** Receipts on the review queue. Default: 3 stub receipts. */
  queueReceipts?: Array<{
    id: string
    status: string
    seller_name?: string
    amount?: number
  }>
  /** Mock POST /receipts/:id/approve status. Default: 200 */
  approveStatus?: number
  /** Mock POST /receipts/:id/reject status. Default: 200 */
  rejectStatus?: number
}

/**
 * mockAdminApi — registers page.route() interceptors for admin endpoints.
 * Call BEFORE page.goto().
 *
 * Signature: mockAdminApi(page, opts?)
 */
export async function mockAdminApi(
  page: Page,
  opts: MockAdminApiOpts = {},
): Promise<void> {
  const {
    queueReceipts = [
      { id: '101', status: 'on_review', seller_name: 'Иван Иванов', amount: 1200 },
      { id: '102', status: 'on_review', seller_name: 'Мария Смирнова', amount: 850 },
      { id: '103', status: 'pending',   seller_name: 'Алексей Морозов', amount: 560 },
    ],
    approveStatus = 200,
    rejectStatus = 200,
  } = opts

  const backendReceipts = queueReceipts.map((r, i) => ({
    id: Number(r.id) || i + 100,
    seller_id: 12345 + i,
    brand_id: 1,
    status: r.status,
    bonus_amount: Math.round((r.amount ?? 1000) * 0.1),
    rejection_reason: null,
    file_url: null,
    shop_name: r.seller_name ? `Магазин · ${r.seller_name}` : '—',
    shop_inn: null,
    total_sum: r.amount ?? 1000,
    created_at: new Date().toISOString(),
    updated_at: null,
    items: [],
    fraud_signals: [],
  }))

  // GET /receipts?status=... (admin review queue — uses getAdminReceipts)
  await page.route('**/api/v1/receipts*', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: backendReceipts,
          total: backendReceipts.length,
          page: 1,
          limit: 20,
        }),
      })
    } else {
      void route.continue()
    }
  })

  // POST /receipts/:id/approve
  await page.route('**/api/v1/receipts/*/approve', (route) => {
    void route.fulfill({ status: approveStatus, contentType: 'application/json', body: 'null' })
  })

  // POST /receipts/:id/reject
  await page.route('**/api/v1/receipts/*/reject', (route) => {
    void route.fulfill({ status: rejectStatus, contentType: 'application/json', body: 'null' })
  })

  // POST /receipts/:id/revise
  await page.route('**/api/v1/receipts/*/revise', (route) => {
    void route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
  })

  // GET /payout-requests
  await page.route('**/api/v1/payout-requests*', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, limit: 50, has_more: false }),
      })
    } else {
      void route.continue()
    }
  })

  // GET /sellers (admin seller list)
  await page.route('**/api/v1/sellers*', (route) => {
    if (route.request().method() === 'GET') {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0, page: 1, limit: 50, has_more: false }),
      })
    } else {
      void route.continue()
    }
  })

  // GET /notifications (admin might also hit this)
  await page.route('**/api/v1/notifications*', (route) => {
    void route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0, page: 1, limit: 50, has_more: false }),
    })
  })
}

// ---------------------------------------------------------------------------
// Extended test fixture
// ---------------------------------------------------------------------------

type TelegramFixtures = {
  /** Injects window.Telegram mock. Playwright calls this before each test. */
  telegramUser: TelegramUser
}

export const test = base.extend<TelegramFixtures>({
  telegramUser: [
    async ({ page }, use) => {
      // Install the default mock; individual tests can call mockTelegramInitData
      // again with a custom user before page.goto().
      await mockTelegramInitData(page, MOCK_USER)
      await use(MOCK_USER)
    },
    { auto: false }, // opt-in: tests that need the mock declare `{ telegramUser }`
  ],
})

export { expect } from '@playwright/test'
