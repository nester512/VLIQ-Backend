/**
 * Smoke suite — verifies the app boots, auth gate renders, and the splash clears.
 *
 * These tests run WITHOUT a real backend (no auth token is injected) so we land
 * on the AuthGate idle/error screen rather than seller-home.  That's intentional
 * for the smoke pass: we verify the shell renders and there are no JS crashes.
 *
 * A separate integration pass (out of scope here) would inject a real/mocked JWT
 * and verify the full seller flow.
 */

import { test, expect } from '@playwright/test'
import { mockTelegramInitData } from './fixtures/telegram'

// Console errors to ignore — these are expected in a no-backend environment
const IGNORED_CONSOLE_PATTERNS = [
  /favicon/i,
  /Failed to load resource/i,
  // Axios network errors when backend is not running
  /Network Error/i,
  /ERR_CONNECTION_REFUSED/i,
  // React 19 in dev mode logs acting warnings
  /act\(/i,
  // Telegram SDK loading from external URL may fail in test env
  /telegram\.org/i,
]

function isIgnoredMessage(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text))
}

test.describe('App smoke', () => {
  test('app boots without JS errors', async ({ page }) => {
    const jsErrors: string[] = []
    const consoleErrors: string[] = []

    page.on('pageerror', (err) => {
      jsErrors.push(err.message)
    })

    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isIgnoredMessage(msg.text())) {
        consoleErrors.push(msg.text())
      }
    })

    // Inject Telegram mock so isTmaEnvironment() returns true
    await mockTelegramInitData(page)

    await page.goto('/')

    // Wait for React to mount — the root div should have children
    await page.waitForFunction(() => {
      const root = document.getElementById('root')
      return root !== null && root.children.length > 0
    }, { timeout: 10_000 })

    // The app should render SOMETHING — either auth gate or seller home
    // We just verify no blank white screen
    const rootContent = await page.locator('#root').innerHTML()
    expect(rootContent.trim().length).toBeGreaterThan(0)

    // No unhandled JS errors
    expect(jsErrors, `Unhandled JS errors: ${jsErrors.join(', ')}`).toHaveLength(0)

    // No unexpected console errors
    expect(
      consoleErrors,
      `Unexpected console errors:\n${consoleErrors.join('\n')}`,
    ).toHaveLength(0)
  })

  test('splash (#vliq-splash) disappears after React mounts', async ({ page }) => {
    await mockTelegramInitData(page)

    // Before React mounts the splash is visible (opacity: 1, no .hidden class)
    await page.goto('/')

    // Wait up to 5s for the splash to get the 'hidden' class OR be removed
    await page.waitForFunction(
      () => {
        const splash = document.getElementById('vliq-splash')
        if (!splash) return true // removed entirely — that's fine
        return (
          splash.classList.contains('hidden') ||
          getComputedStyle(splash).opacity === '0' ||
          splash.style.opacity === '0'
        )
      },
      { timeout: 5_000 },
    )

    const splash = page.locator('#vliq-splash')
    const splashCount = await splash.count()

    if (splashCount > 0) {
      // Still in DOM — must be invisible
      const opacity = await splash.evaluate((el) => getComputedStyle(el).opacity)
      // Opacity should be 0 (or transitioning toward 0 — we check .hidden class)
      const hasHiddenClass = await splash.evaluate((el) => el.classList.contains('hidden'))
      expect(
        hasHiddenClass || opacity === '0',
        `Splash still visible: opacity=${opacity}, classes=${await splash.getAttribute('class')}`,
      ).toBe(true)
    }
    // else: splash was removed from DOM — perfect
  })

  test('VLIQ title is present in page content', async ({ page }) => {
    await mockTelegramInitData(page)
    await page.goto('/')

    // Wait for React to mount
    await page.waitForFunction(() => {
      const root = document.getElementById('root')
      return root !== null && root.children.length > 0
    }, { timeout: 10_000 })

    // The app always shows "VLIQ" somewhere — splash title, auth gate h1, or app header
    const pageText = await page.locator('body').innerText()
    expect(pageText).toContain('VLIQ')
  })
})
