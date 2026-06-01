/**
 * Friendly-errors contract suite.
 *
 * Verifies that raw JSON error bodies (legacy shape like {"detail": "..."})
 * NEVER appear as visible text in the UI.  The frontend must always render
 * a human-readable message.
 *
 * Two backend response shapes are tested:
 *   1. Legacy:  {"detail": "Internal Server Error"}  (HTTP 500)
 *   2. New:     {"code": "AUTH_INVALID_INIT_DATA", "user_message": "Ошибка авторизации"}
 *
 * Both should result in a friendly Russian string, NOT raw JSON.
 */

import { test, expect } from '@playwright/test'
import { mockTelegramInitData } from './fixtures/telegram'

// Patterns that indicate raw JSON leaked to the UI
const RAW_JSON_PATTERNS = [
  /^\{/, // starts with {
  /"detail"\s*:/, // contains "detail": (FastAPI legacy)
  /Internal Server Error/, // English internal error
  /\{"code"/, // raw new-shape JSON
]

function containsRawJson(text: string): boolean {
  return RAW_JSON_PATTERNS.some((re) => re.test(text))
}

test.describe('Friendly error contract', () => {
  test('legacy 500 {"detail": "..."} does not leak to UI', async ({ page }) => {
    // Intercept the TMA verify endpoint BEFORE navigation
    await page.route('**/api/v1/auth/tma-verify', (route) => {
      void route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal Server Error' }),
      })
    })
    // Also intercept /auth/tma-verify (without v1 prefix)
    await page.route('**/auth/tma-verify', (route) => {
      void route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Internal Server Error' }),
      })
    })

    await mockTelegramInitData(page)
    await page.goto('/')

    // Wait for React to mount and auth to settle (loading → error state)
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root')
        return root !== null && root.children.length > 0
      },
      { timeout: 10_000 },
    )

    // Give auth flow time to complete and render error state
    await page.waitForTimeout(2_000)

    const bodyText = await page.locator('body').innerText()

    // Must NOT contain raw JSON
    expect(
      containsRawJson(bodyText),
      `Raw JSON leaked to UI. Body text (first 500 chars):\n${bodyText.slice(0, 500)}`,
    ).toBe(false)
  })

  test('new error shape {"code":"AUTH_INVALID_INIT_DATA"} does not leak to UI', async ({ page }) => {
    await page.route('**/api/v1/auth/tma-verify', (route) => {
      void route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'AUTH_INVALID_INIT_DATA',
          user_message: 'Ошибка авторизации',
        }),
      })
    })
    await page.route('**/auth/tma-verify', (route) => {
      void route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'AUTH_INVALID_INIT_DATA',
          user_message: 'Ошибка авторизации',
        }),
      })
    })

    await mockTelegramInitData(page)
    await page.goto('/')

    await page.waitForFunction(
      () => {
        const root = document.getElementById('root')
        return root !== null && root.children.length > 0
      },
      { timeout: 10_000 },
    )

    await page.waitForTimeout(2_000)

    const bodyText = await page.locator('body').innerText()

    // The new shape's user_message "Ошибка авторизации" may appear — that's fine
    // What must NOT appear is raw JSON or English internal error strings
    expect(
      containsRawJson(bodyText),
      `Raw JSON leaked to UI. Body text (first 500 chars):\n${bodyText.slice(0, 500)}`,
    ).toBe(false)
  })

  test('no DOM text node starts with { (raw JSON anywhere)', async ({ page }) => {
    await mockTelegramInitData(page)
    await page.goto('/')

    await page.waitForFunction(
      () => {
        const root = document.getElementById('root')
        return root !== null && root.children.length > 0
      },
      { timeout: 10_000 },
    )

    await page.waitForTimeout(1_500)

    // Walk all text nodes looking for raw JSON
    const rawJsonNodes = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      )
      const found: string[] = []
      let node = walker.nextNode()
      while (node !== null) {
        const text = node.textContent?.trim() ?? ''
        if (text.startsWith('{') && text.length > 2) {
          found.push(text.slice(0, 100))
        }
        node = walker.nextNode()
      }
      return found
    })

    expect(
      rawJsonNodes,
      `Raw JSON text nodes found: ${rawJsonNodes.join(', ')}`,
    ).toHaveLength(0)
  })
})
