/**
 * No-horizontal-overflow suite.
 *
 * For every key route, asserts that the page does not produce horizontal
 * scroll (scrollWidth <= innerWidth + 1px for sub-pixel tolerance).
 *
 * These tests run WITHOUT a backend.  Routes that require auth will render
 * the AuthGate error screen — we still check overflow on that screen.
 * Routes under /seller/* will redirect to / because no auth token is injected,
 * so the actual overflow check lands on the AuthGate — which is still valid
 * (we're checking the rendered output).
 *
 * To check overflow on authenticated pages, inject a JWT via injectAuthToken()
 * in a future authenticated overflow suite.
 */

import { test, expect } from '@playwright/test'
import { mockTelegramInitData } from './fixtures/telegram'

const ROUTES = [
  '/',
  '/seller/home',
  '/seller/history',
  '/seller/promo',
  '/seller/profile',
]

test.describe.parallel('No horizontal overflow', () => {
  for (const route of ROUTES) {
    test(`no overflow on ${route}`, async ({ page }) => {
      await mockTelegramInitData(page)
      await page.goto(route)

      // Wait for React to mount and content to be visible
      await page.waitForFunction(
        () => {
          const root = document.getElementById('root')
          return root !== null && root.children.length > 0
        },
        { timeout: 10_000 },
      )

      // Small pause for layout/animations to settle
      await page.waitForTimeout(500)

      const hasOverflow = await page.evaluate(() => {
        // Check both document and body for overflow
        const docOverflow = document.documentElement.scrollWidth > window.innerWidth + 1
        const bodyOverflow = document.body.scrollWidth > window.innerWidth + 1
        return {
          docOverflow,
          bodyOverflow,
          docScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
        }
      })

      expect(
        hasOverflow.docScrollWidth,
        `Route ${route}: document.documentElement.scrollWidth (${hasOverflow.docScrollWidth}) > innerWidth (${hasOverflow.innerWidth} + 1)`,
      ).toBeLessThanOrEqual(hasOverflow.innerWidth + 1)

      expect(
        hasOverflow.bodyScrollWidth,
        `Route ${route}: document.body.scrollWidth (${hasOverflow.bodyScrollWidth}) > innerWidth (${hasOverflow.innerWidth} + 1)`,
      ).toBeLessThanOrEqual(hasOverflow.innerWidth + 1)
    })
  }
})
