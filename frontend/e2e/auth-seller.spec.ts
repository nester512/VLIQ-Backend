/**
 * T2 — Auth seller flow
 *
 * Tests that a seller with a pre-seeded auth token can access authenticated
 * pages and interact with the seller UI.  All API calls are mocked via
 * page.route() so no backend is required.
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockSellerApi,
  MOCK_SELLER_JWT,
} from './fixtures/telegram'

test.describe('Auth seller flow', () => {
  test.beforeEach(async ({ page }) => {
    // Inject Telegram mock + auth token BEFORE any navigation
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_SELLER_JWT, 'seller')
  })

  test('seller with active status lands on /seller/home and sees Hero balance', async ({ page }) => {
    await mockSellerApi(page, { status: 'active', available: 5000 })
    await page.goto('/seller/home')

    // Wait for React to render — the HeroBalance renders "Доступно к выплате"
    await expect(page.getByText('Доступно к выплате')).toBeVisible({ timeout: 10_000 })
  })

  test('seller can navigate tabs without overflow or errors', async ({ page }) => {
    await mockSellerApi(page, { status: 'active' })

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await page.goto('/seller/home')
    await expect(page.getByText('Доступно к выплате')).toBeVisible({ timeout: 10_000 })

    // Navigate to History (/seller/history) via URL — tab bar links
    await page.goto('/seller/history')
    await expect(page).toHaveURL(/\/seller\/history/, { timeout: 8_000 })

    // Navigate to Promo (/seller/promo)
    await page.goto('/seller/promo')
    await expect(page).toHaveURL(/\/seller\/promo/, { timeout: 8_000 })

    // Navigate to Profile (/seller/profile)
    await page.goto('/seller/profile')
    await expect(page).toHaveURL(/\/seller\/profile/, { timeout: 8_000 })

    // No horizontal overflow on any page
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow, 'Horizontal overflow detected on /seller/profile').toBe(false)

    // Filter out expected Vite/React dev noise (e.g. unknown TMA method warnings)
    const hardErrors = consoleErrors.filter(
      (e) =>
        !e.includes('react-router') &&
        !e.includes('telegram-web-app') &&
        !e.includes('ResizeObserver') &&
        !e.includes('Non-envelope') &&
        !e.includes('TMA'),
    )
    expect(hardErrors, `Console errors: ${hardErrors.join('\n')}`).toHaveLength(0)
  })

  test('notification bell shows badge when there are unread notifications', async ({ page }) => {
    await mockSellerApi(page, { status: 'active', hasUnread: true })
    await page.goto('/seller/home')

    // Wait for the header to render with the bell button
    const bellBtn = page.getByRole('button', { name: /уведомления/i })
    await expect(bellBtn).toBeVisible({ timeout: 10_000 })

    // The badge is rendered as a <span> inside the bell button when there are
    // unread notifications.  It has no text content (it's a dot), so we check
    // for the aria-label that includes the count.
    await expect(
      page.getByRole('button', { name: /уведомления, \d+ нов/i }),
    ).toBeVisible({ timeout: 8_000 })
  })
})
