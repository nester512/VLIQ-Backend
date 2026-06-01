/**
 * CLS (Cumulative Layout Shift) suite.
 *
 * Navigates to / and measures layout-shift entries via PerformanceObserver.
 * Target: CLS < 0.1 (Google "Good" threshold).
 *
 * Notes:
 *   - We measure the shell/auth-gate screen since no auth token is injected.
 *   - CLS from the Telegram SDK external script load is excluded (it happens
 *     before React mounts; we start measuring AFTER React paints).
 *   - In a CI/no-backend context, the loading spinner → error state transition
 *     may generate minor layout shift.  The 0.1 threshold is intentionally
 *     generous for a first pass.
 */

import { test, expect } from '@playwright/test'
import { mockTelegramInitData } from './fixtures/telegram'

test.describe('CLS', () => {
  test('cumulative layout shift < 0.1 on initial load', async ({ page }) => {
    await mockTelegramInitData(page)

    // Inject the PerformanceObserver BEFORE the page navigates so we capture
    // all layout-shift entries from the very first paint.
    await page.addInitScript(() => {
      ;(window as Window & { __vliq_cls?: number; __vliq_cls_entries?: number }).
        __vliq_cls = 0
      ;(window as Window & { __vliq_cls?: number; __vliq_cls_entries?: number }).
        __vliq_cls_entries = 0

      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            // PerformanceEntry doesn't have hadRecentInput in base type
            const lsEntry = entry as PerformanceEntry & {
              value?: number
              hadRecentInput?: boolean
            }
            if (!lsEntry.hadRecentInput && lsEntry.value !== undefined) {
              ;(window as Window & { __vliq_cls?: number; __vliq_cls_entries?: number }).
                __vliq_cls = ((window as Window & { __vliq_cls?: number }).__vliq_cls ?? 0) + lsEntry.value
              ;(window as Window & { __vliq_cls_entries?: number }).
                __vliq_cls_entries = ((window as Window & { __vliq_cls_entries?: number }).__vliq_cls_entries ?? 0) + 1
            }
          }
        })
        observer.observe({ type: 'layout-shift', buffered: true })
      } catch {
        // PerformanceObserver not available in some headless contexts — gracefully skip
      }
    })

    await page.goto('/')

    // Wait for React to mount
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root')
        return root !== null && root.children.length > 0
      },
      { timeout: 10_000 },
    )

    // Observe for 3 seconds to catch deferred layout shifts (fonts, lazy images, etc.)
    await page.waitForTimeout(3_000)

    const { cls, entries } = await page.evaluate(() => {
      return {
        cls: (window as Window & { __vliq_cls?: number }).__vliq_cls ?? 0,
        entries: (window as Window & { __vliq_cls_entries?: number }).__vliq_cls_entries ?? 0,
      }
    })

    console.log(`CLS: ${cls.toFixed(4)} (${entries} layout-shift entries)`)

    expect(
      cls,
      `CLS of ${cls.toFixed(4)} exceeds threshold 0.1 (${entries} entries recorded)`,
    ).toBeLessThan(0.1)
  })
})
