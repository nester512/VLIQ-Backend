/**
 * e2e-real/fixtures/auth.ts — Shared auth helpers for real-backend tests.
 *
 * Unlike the mock suite's injectAuthToken() which pre-seeds a dummy JWT,
 * these helpers inject the REAL JWTs obtained by globalSetup from the
 * running backend.
 */

import type { Page } from '@playwright/test'

const BASE = 'http://localhost:8080'

// Node 18+ has built-in global fetch — no import needed.

// ---------------------------------------------------------------------------
// Zustand persist key — must match authStore.ts `name: 'vliq-auth'`
// ---------------------------------------------------------------------------

function setAuthInLocalStorage(page: Page, token: string, role: string) {
  return page.addInitScript(
    ({ token, role }: { token: string; role: string }) => {
      try {
        localStorage.setItem(
          'vliq-auth',
          JSON.stringify({ state: { token, role }, version: 0 }),
        )
      } catch {
        // blocked in some sandboxed contexts
      }
    },
    { token, role },
  )
}

// ---------------------------------------------------------------------------
// Minimal Telegram WebApp stub (prevents "window.Telegram is undefined" errors
// from @telegram-apps/sdk-react before it detects non-TMA environment).
// ---------------------------------------------------------------------------

function injectTelegramStub(page: Page) {
  return page.addInitScript(() => {
    const stub = {
      initData: '',
      initDataUnsafe: {},
      colorScheme: 'light' as const,
      themeParams: {},
      ready: () => {},
      expand: () => {},
      close: () => {},
      onEvent: () => {},
      offEvent: () => {},
      BackButton: { isVisible: false, show: () => {}, hide: () => {}, onClick: () => {}, offClick: () => {} },
      MainButton: { isVisible: false, text: '', show: () => {}, hide: () => {}, onClick: () => {}, offClick: () => {} },
      HapticFeedback: { impactOccurred: () => {}, notificationOccurred: () => {}, selectionChanged: () => {} },
      version: '6.9',
      platform: 'web',
      isExpanded: true,
      viewportHeight: 844,
      viewportStableHeight: 844,
    }
    try {
      Object.defineProperty(window, 'Telegram', { value: { WebApp: stub }, writable: true, configurable: true })
    } catch {
      ;(window as unknown as Record<string, unknown>)['Telegram'] = { WebApp: stub }
    }
  })
}

// ---------------------------------------------------------------------------
// loginAsSeller
// ---------------------------------------------------------------------------

/**
 * loginAsSeller — injects the real seller JWT (from globalSetup) into
 * localStorage, then navigates to / and waits for redirect to /seller/home.
 */
export async function loginAsSeller(page: Page): Promise<void> {
  const token = process.env['VLIQ_SELLER_JWT']
  if (!token) {
    throw new Error('VLIQ_SELLER_JWT not set — did globalSetup run?')
  }
  await injectTelegramStub(page)
  await setAuthInLocalStorage(page, token, 'seller')
  await page.goto('/')
  await page.waitForURL(/\/seller\/home/, { timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// loginAsAdmin
// ---------------------------------------------------------------------------

/**
 * loginAsAdmin — injects the admin JWT (if available) into localStorage.
 * Navigates to /admin/dash.
 *
 * NOTE: At time of writing the backend /auth/login always returns role='seller'
 * even for telegram_id=99999, so VLIQ_ADMIN_AVAILABLE=false and admin tests
 * call test.skip() before this is reached.  This helper is wired up for when
 * the backend ships admin-aware auth.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  const token = process.env['VLIQ_ADMIN_JWT']
  if (!token) {
    throw new Error('VLIQ_ADMIN_JWT not set — did globalSetup run?')
  }
  await injectTelegramStub(page)
  await setAuthInLocalStorage(page, token, 'super_admin')
  await page.goto('/')
  await page.waitForURL(/\/admin\/dash/, { timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// seedReceiptForSeller
// ---------------------------------------------------------------------------

/**
 * seedReceiptForSeller — POSTs a QR payload to /receipts/qr-payload using
 * the real seller JWT.  Returns the receipt_id from the response.
 *
 * NOTE: The /receipts/qr-payload endpoint has a backend bug (UniqueViolation
 * on file_hash='') that causes 500 on every call.  Use this helper only if
 * the backend bug is fixed; otherwise use existing seeded receipt IDs directly.
 */
export async function seedReceiptForSeller(qrRaw: string, brandId = 1): Promise<number> {
  const token = process.env['VLIQ_SELLER_JWT']
  if (!token) {
    throw new Error('VLIQ_SELLER_JWT not set — did globalSetup run?')
  }

  const res = await fetch(`${BASE}/api/v1/receipts/qr-payload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ qr_raw: qrRaw, brand_id: brandId }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`POST /receipts/qr-payload failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as { receipt_id: number }
  return data.receipt_id
}
