/**
 * Real-backend smoke test
 *
 * Runs ONLY when E2E_REAL_BACKEND env var is set (non-empty).
 * In normal CI (mocked suite) this file is skipped automatically.
 *
 * This test:
 *   1. Visits the app root
 *   2. Asserts no hard console errors
 *   3. Asserts the initial loading/splash screen eventually disappears
 *      (i.e. the app boots without crashing even with a real backend)
 *
 * Deeper coverage with the real backend is P2.
 *
 * Prerequisites (see playwright.real.config.ts for full instructions):
 *   - docker compose up -d (backend on http://localhost:8000)
 *   - Vite dev server on http://localhost:4321
 */

import { test, expect } from '@playwright/test'

const realBackend = Boolean(process.env['E2E_REAL_BACKEND'])

test.describe('Real-backend smoke', () => {
  test('app boots without hard console errors', async ({ page }) => {
    test.skip(!realBackend, 'Skipped: E2E_REAL_BACKEND not set. See playwright.real.config.ts for usage.')

    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })

    // Navigate to root — may show auth loading or TMA mock screen
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // Wait for React to mount
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root')
        return root !== null && root.children.length > 0
      },
      { timeout: 15_000 },
    )

    // Allow time for initial API calls to settle
    await page.waitForTimeout(3_000)

    // The "Авторизация…" spinner (from AuthGate) should eventually disappear
    // — either the app logs in or it shows an error state.  What it must NOT do
    // is stay frozen with the Spinner forever (which would indicate a boot crash).
    const spinnerVisible = await page.locator('[data-testid="auth-spinner"]').isVisible().catch(() => false)
    // If no data-testid — fall back to checking that the root has rendered
    const rootHasContent = await page.evaluate(() => {
      const root = document.getElementById('root')
      return root ? root.innerText.trim().length > 0 : false
    })
    expect(rootHasContent, 'App root should have rendered some content').toBe(true)

    // Filter out expected dev-mode noise
    const hardErrors = consoleErrors.filter(
      (e) =>
        !e.includes('telegram-web-app') &&
        !e.includes('ResizeObserver') &&
        !e.includes('Non-envelope') &&
        !e.includes('TMA') &&
        !e.includes('react-router'),
    )

    expect(
      hardErrors,
      `Console errors detected:\n${hardErrors.join('\n')}`,
    ).toHaveLength(0)

    // Smoke: no "Ошибка авторизации" raw error on the screen from a crash
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('Uncaught')
    expect(bodyText).not.toContain('undefined is not')
    expect(bodyText).not.toContain('Cannot read')

    // Suppress the unused variable warning for spinnerVisible
    void spinnerVisible
  })

  test('splash / loading state disappears within 10s', async ({ page }) => {
    test.skip(!realBackend, 'Skipped: E2E_REAL_BACKEND not set. See playwright.real.config.ts for usage.')

    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // The Spinner in AuthGate shows "Авторизация…" during loading.
    // It should disappear once auth completes (or fails gracefully).
    const authText = page.getByText('Авторизация…')
    // Either it was never there (already resolved) or it resolves within 10s
    try {
      await expect(authText).not.toBeVisible({ timeout: 10_000 })
    } catch {
      // If it's still showing after 10s, the app may be stuck — fail with context
      const url = page.url()
      const html = await page.content()
      throw new Error(
        `Auth loading spinner still visible after 10s at URL ${url}.\n` +
        `First 500 chars of HTML: ${html.slice(0, 500)}`,
      )
    }
  })
})
