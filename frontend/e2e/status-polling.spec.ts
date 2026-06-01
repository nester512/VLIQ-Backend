/**
 * T1 — Status polling timing
 *
 * Verifies the upload → status poll flow.  After upload, the seller lands on
 * /seller/status/:id and the app polls GET /receipts/:id/status every 3 s
 * (refetchInterval in StatusPage.tsx).  We mock the endpoint with a counter
 * so successive calls return a SEQUENCE of statuses and assert the UI
 * eventually shows the terminal "approved" state + bonus amount.
 *
 * Closure-counter pattern: same technique used in the existing
 * mockSellerApi() fixture (e2e/fixtures/telegram.ts line 417-431).
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockSellerApi,
  MOCK_SELLER_JWT,
} from './fixtures/telegram'

test.describe('Status polling flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_SELLER_JWT, 'seller')
  })

  test('status transitions from pending → ocr_in_progress → approved', async ({ page }) => {
    // Sequence:
    //   call 1 → pending          (initial mount)
    //   call 2 → ocr_in_progress  (3 s poll — refetchInterval returns 3000)
    //   call 3 → approved + bonus (6 s poll — polling stops after this)
    //
    // StatusPage.tsx refetchInterval logic:
    //   pending | ocr_in_progress → 3000 ms  (keeps polling)
    //   anything else → false               (stops polling)
    //
    // NOTE on route priority (Playwright LIFO):
    // mockSellerApi registers '**/api/v1/receipts/*/status' internally.
    // We override the global wildcard route BEFORE calling mockSellerApi so
    // that our closure-counter route (registered LAST, i.e. highest priority)
    // handles all /receipts/*/status calls for this test.

    // Register base seller mocks FIRST (lower LIFO priority).
    // mockSellerApi internally registers '**/api/v1/receipts/*/status' with its
    // own static sequence.  We then register OUR counter route AFTER (higher
    // LIFO priority) so Playwright routes all /status requests through ours.
    await mockSellerApi(page, { status: 'active', uploadReceiptId: 999 })

    // Override the status endpoint with a 3-step sequence.
    // Registered AFTER mockSellerApi → higher LIFO priority → runs first.
    //   call 1 → pending          (initial mount, polling starts)
    //   call 2 → ocr_in_progress  (3 s poll, polling continues)
    //   call 3 → approved + bonus (6 s poll, polling stops)
    const statusSequence = [
      { status: 'pending',         bonus_amount: null },
      { status: 'ocr_in_progress', bonus_amount: null },
      { status: 'approved',        bonus_amount: 150  },
    ]
    let statusCallCount = 0

    await page.route('**/api/v1/receipts/*/status', (route) => {
      const entry = statusSequence[Math.min(statusCallCount, statusSequence.length - 1)]!
      statusCallCount++
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'r-test',
          receipt_id: 'r-test',
          status: entry.status,
          bonus_amount: entry.bonus_amount,
          rejection_reason: null,
          created_at: new Date().toISOString(),
        }),
      })
    })

    // Navigate directly to the status page (simulates post-upload redirect)
    await page.goto('/seller/status/r-test')

    // Wait for the terminal approved state.
    // StatusPage STATUS_VISUAL.approved.title = 'Чек одобрен'
    // With a 3 s polling interval: initial + 2 polls = ~6 s max.
    // We give 15 s to absorb startup latency.
    await expect(
      page.locator('h2').filter({ hasText: 'Чек одобрен' }),
    ).toBeVisible({ timeout: 15_000 })

    // After approved, the bonus card should display the bonus amount.
    // StatusPage renders a ".vliq-card" with "Начислено" label when approved.
    const bonusCard = page.locator('.vliq-card').filter({ hasText: 'Начислено' })
    await expect(bonusCard).toBeVisible({ timeout: 5_000 })

    // The bonus section should also contain "₽"
    await expect(bonusCard.getByText(/₽/)).toBeVisible({ timeout: 5_000 })
  })

  test('status page shows pending state on initial load', async ({ page }) => {
    // Single call always returns pending
    await mockSellerApi(page, { status: 'active' })

    await page.route('**/api/v1/receipts/r-pending/status', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'r-pending',
          receipt_id: 'r-pending',
          status: 'pending',
          bonus_amount: undefined,
          rejection_reason: null,
          created_at: new Date().toISOString(),
        }),
      })
    })

    await page.goto('/seller/status/r-pending')

    // StatusPage STATUS_VISUAL.pending.title = 'Чек получен'
    await expect(
      page.locator('h2').filter({ hasText: 'Чек получен' }),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('status page shows rejected state with rejection reason', async ({ page }) => {
    await mockSellerApi(page, { status: 'active' })

    await page.route('**/api/v1/receipts/r-rejected/status', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'r-rejected',
          receipt_id: 'r-rejected',
          status: 'rejected',
          bonus_amount: null,
          rejection_reason: 'Чек уже был загружен ранее',
          created_at: new Date().toISOString(),
        }),
      })
    })

    await page.goto('/seller/status/r-rejected')

    // StatusPage STATUS_VISUAL.rejected.title = 'Чек отклонён'
    await expect(
      page.locator('h2').filter({ hasText: 'Чек отклонён' }),
    ).toBeVisible({ timeout: 10_000 })

    // The rejection_reason should be displayed in the status card
    await expect(page.getByText('Чек уже был загружен ранее')).toBeVisible({ timeout: 5_000 })
  })
})
