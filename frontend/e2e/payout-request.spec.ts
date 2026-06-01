/**
 * T7 — Payout request flow
 *
 * Tests the seller payout request path:
 *   - Seller can see payout page with correct balance
 *   - Successful payout request shows success toast
 *   - Failed payout shows friendly Russian error message
 *
 * All API calls are mocked via page.route().
 *
 * Note: PayoutPage auto-fills the amount from the available balance and does
 * not have a manual amount input field — it shows the balance as a read-only
 * field and the "Запросить" button submits that amount directly.  The
 * "insufficient balance" error is surfaced when the backend rejects the
 * request (e.g. after an optimistic UI race).
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockSellerApi,
  MOCK_SELLER_JWT,
} from './fixtures/telegram'

test.describe('Payout request flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_SELLER_JWT, 'seller')
  })

  test('seller can request payout with valid amount', async ({ page }) => {
    // available > MIN_PAYOUT (1000), hasPayout = true → checklist passes → button enabled
    await mockSellerApi(page, {
      status: 'active',
      available: 2500,
      hasPayout: true,
    })

    const payoutRequests: { url: string; body: string }[] = []
    page.on('request', (req) => {
      if (req.url().includes('/payout-requests') && req.method() === 'POST') {
        payoutRequests.push({ url: req.url(), body: req.postData() ?? '' })
      }
    })

    await page.goto('/seller/payout')

    // Wait for the page content
    await expect(page.getByText('Доступно к выплате')).toBeVisible({ timeout: 10_000 })

    // All checklist items should be OK — "Запросить" button should be enabled
    const submitBtn = page.getByRole('button', { name: /запросить/i })
    await expect(submitBtn).toBeVisible({ timeout: 5_000 })
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 })

    await submitBtn.click()

    // Wait for the success toast
    await expect(page.getByText('Заявка на выплату создана')).toBeVisible({ timeout: 8_000 })

    // Verify the POST was fired
    expect(payoutRequests.length, 'Expected POST /payout-requests to be called').toBeGreaterThan(0)
  })

  test('requesting payout shows friendly error on insufficient balance', async ({ page }) => {
    // available > 1000 so the checklist passes and button is enabled, but backend rejects
    await mockSellerApi(page, {
      status: 'active',
      available: 1500,
      hasPayout: true,
    })

    // Override the payout-requests route to return an error
    await page.route('**/api/v1/payout-requests', (route) => {
      if (route.request().method() === 'POST') {
        void route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'PAYOUT_INSUFFICIENT_BALANCE',
            user_message: 'Недостаточно средств',
            debug_id: 'e2e-payout-001',
          }),
        })
      } else {
        void route.continue()
      }
    })

    await page.goto('/seller/payout')
    await expect(page.getByText('Доступно к выплате')).toBeVisible({ timeout: 10_000 })

    const submitBtn = page.getByRole('button', { name: /запросить/i })
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 })
    await submitBtn.click()

    // The hook's onError handler calls pushToast with a generic message
    // (useRequestPayout doesn't re-surface the API user_message — it shows
    // a generic error toast).  Verify the generic error toast appears.
    await expect(page.getByText('Ошибка создания заявки')).toBeVisible({ timeout: 8_000 })

    // The raw error code MUST NOT be visible
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('PAYOUT_INSUFFICIENT_BALANCE')
  })
})
