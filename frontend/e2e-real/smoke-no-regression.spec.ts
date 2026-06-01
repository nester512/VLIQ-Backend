/**
 * smoke-no-regression.spec.ts — Real-backend smoke + no-regression checks.
 *
 * All 3 viewports. Navigates to key routes and asserts:
 *   - No hard console errors (filtered for known benign noise).
 *   - No horizontal overflow.
 *   - No raw {"detail": or traceback strings visible in the page body.
 *
 * Seller routes (/seller/home, /seller/history, /) use the real seller JWT.
 * Admin route (/admin/dash) is tested with the admin JWT (if available);
 * otherwise skipped so only the seller smoke runs.
 */

import { test, expect } from '@playwright/test'
import { loginAsSeller, loginAsAdmin } from './fixtures/auth'

const SELLER_ROUTES = ['/', '/seller/home', '/seller/history'] as const

/** Checks scrollWidth ≤ innerWidth + 1 on both html and body. */
async function assertNoHorizontalOverflow(page: import('@playwright/test').Page, label: string) {
  const result = await page.evaluate(() => ({
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    result.docScrollWidth,
    `${label}: documentElement.scrollWidth=${result.docScrollWidth} > innerWidth=${result.innerWidth}+1`,
  ).toBeLessThanOrEqual(result.innerWidth + 1)
  expect(
    result.bodyScrollWidth,
    `${label}: body.scrollWidth=${result.bodyScrollWidth} > innerWidth=${result.innerWidth}+1`,
  ).toBeLessThanOrEqual(result.innerWidth + 1)
}

/** Known benign error patterns that should not fail the test. */
function isBenignError(text: string): boolean {
  return (
    text.includes('telegram-web-app') ||
    text.includes('Non-envelope') ||
    text.includes('TMA') ||
    text.includes('ResizeObserver') ||
    text.includes('react-router') ||
    // Google Fonts CORS — expected when fonts are loaded from external CDN
    text.includes('fonts.gstatic.com') ||
    text.includes('fonts.googleapis.com') ||
    // "Failed to load resource" from font CORS
    (text.includes('Failed to load resource') && text.includes('net::ERR_FAILED')) ||
    // 403 from admin stats endpoints when accessed as seller (admin dash only)
    text.includes('403') ||
    // Notification polling may return 403 in some states
    text.includes('AUTH_FORBIDDEN')
  )
}

test.describe('smoke-no-regression (real backend)', () => {
  for (const route of SELLER_ROUTES) {
    test(`seller route ${route} — no console errors / overflow / backend strings`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text())
      })

      await loginAsSeller(page)

      if (route !== '/') {
        await page.goto(route)
        await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')), { timeout: 10_000 })
      }

      // Let React settle + any pending data fetches complete
      await page.waitForLoadState('networkidle').catch(() => null)
      await page.waitForTimeout(500)

      // 1. No horizontal overflow
      await assertNoHorizontalOverflow(page, `${route} [w=${page.viewportSize()?.width}]`)

      // 2. No raw backend error JSON visible in the page body
      const bodyText = await page.locator('body').innerText()
      expect(bodyText, `Route ${route}: raw {"detail": visible in body`).not.toMatch(/\{"detail":/)
      expect(bodyText, `Route ${route}: traceback visible in body`).not.toMatch(/traceback/i)
      expect(bodyText, `Route ${route}: Pydantic error string in body`).not.toMatch(/string_type|value_error/)

      // 3. Filter known-benign console errors
      const hardErrors = consoleErrors.filter((e) => !isBenignError(e))
      expect(hardErrors, `Route ${route}: hard console errors: ${hardErrors.join(' | ')}`).toHaveLength(0)
    })
  }

  test('admin route /admin/dash — no overflow / backend strings', async ({ page }) => {
    test.skip(
      process.env['VLIQ_ADMIN_AVAILABLE'] !== 'true',
      'SKIP: admin JWT unavailable — only seller routes smoke-tested',
    )

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    await loginAsAdmin(page)
    await expect(page).toHaveURL(/\/admin\/dash/, { timeout: 10_000 })

    await page.waitForLoadState('networkidle').catch(() => null)
    await page.waitForTimeout(500)

    // No overflow
    await assertNoHorizontalOverflow(page, '/admin/dash')

    // No raw backend strings
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(/\{"detail":/)
    expect(bodyText).not.toMatch(/traceback/i)

    // Filter benign errors (admin dash loads stats — some may 403 if brand scope not set)
    const hardErrors = consoleErrors.filter((e) => !isBenignError(e))
    expect(hardErrors, `Admin dash: hard console errors: ${hardErrors.join(' | ')}`).toHaveLength(0)
  })
})
