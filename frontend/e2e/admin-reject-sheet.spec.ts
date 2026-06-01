/**
 * T2 — Admin reject reason sheet
 *
 * Tests whether the admin swipe-left (reject) path exposes a reason-input
 * UI (sheet / dialog / inline form).
 *
 * ANALYSIS OF THE CURRENT UI:
 * ---------------------------------------------------------------------------
 * Reading SwipeDeck.tsx + ReviewPage.tsx + ReceiptDetailSheet.tsx reveals:
 *
 * 1. SwipeDeck.tsx: swiping left calls onSwipe(id, 'reject') — which is now
 *    intercepted by ReviewPage.handleSwipe to open a RejectReasonSheet.
 *    The mutation only fires after the admin confirms with a typed reason.
 *
 * 2. ReceiptDetailSheet.tsx: the "Отклонить" button in the detail sheet
 *    calls handleAction('reject') → swipe({ id, dir: 'reject' }) directly.
 *    It does NOT go through the swipe-deck path, so it fires immediately.
 *
 * 3. useReviewQueue.ts: useSwipeAction now passes comment to rejectReceipt(id, comment).
 * ---------------------------------------------------------------------------
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockAdminApi,
  MOCK_ADMIN_JWT,
} from './fixtures/telegram'

test.describe('Admin reject sheet', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_ADMIN_JWT, 'admin')
  })

  /**
   * T2a — Swiping left opens the reason sheet; completing it fires POST /receipts/:id/reject.
   */
  test('swipe left fires reject POST', async ({ page }) => {
    const rejectBodies: string[] = []

    await mockAdminApi(page, {
      queueReceipts: [
        { id: '201', status: 'on_review', seller_name: 'Тест Свайп', amount: 500 },
      ],
    })

    // Capture the actual request body
    await page.route('**/api/v1/receipts/*/reject', (route) => {
      rejectBodies.push(route.request().postData() ?? '')
      void route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    })

    await page.goto('/admin/review')
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/1 \/ 1/)).toBeVisible({ timeout: 5_000 })

    const deckContainer = page.locator('.relative.h-full').first()
    await expect(deckContainer).toBeVisible({ timeout: 5_000 })

    const box = await deckContainer.boundingBox()
    if (!box) throw new Error('Could not get deck bounding box')

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 50, cy)
    await page.mouse.move(cx - 100, cy)
    await page.mouse.move(cx - 150, cy)
    await page.mouse.up()

    // After left swipe, a reason sheet should appear
    const reasonInput = page.getByRole('textbox', { name: /причина|reason|комментарий/i })
    await expect(reasonInput).toBeVisible({ timeout: 5_000 })

    // Fill in a reason and submit
    await reasonInput.fill('Тест причина ОК')
    await page.getByRole('button', { name: /отклонить/i }).last().click()

    // Wait for mutation
    await page.waitForTimeout(600)

    expect(rejectBodies.length, 'POST /reject should have fired once').toBe(1)
    expect(rejectBodies[0]).not.toContain('/201/reject')  // URL is in route, not body
  })

  /**
   * T2b — After swiping left, a reason-input sheet/modal should appear.
   */
  test('swipe left opens reason input before submitting reject', async ({ page }) => {
    await mockAdminApi(page, {
      queueReceipts: [
        { id: '202', status: 'on_review', seller_name: 'Тест Причина', amount: 600 },
      ],
    })

    await page.goto('/admin/review')
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })

    const deckContainer = page.locator('.relative.h-full').first()
    const box = await deckContainer.boundingBox()
    if (!box) throw new Error('Could not get deck bounding box')

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 150, cy)
    await page.mouse.up()

    // After left swipe, a reason sheet/modal should become visible BEFORE the
    // reject POST fires.
    const reasonInput = page.getByRole('textbox', { name: /причина|reason|комментарий/i })
    await expect(reasonInput).toBeVisible({ timeout: 5_000 })
  })

  /**
   * T2c — Typing a reason and confirming should include comment in POST body.
   */
  test('reject body includes typed comment', async ({ page }) => {
    const rejectBodies: unknown[] = []

    await mockAdminApi(page, {
      queueReceipts: [
        { id: '203', status: 'on_review', seller_name: 'Тест Комментарий', amount: 700 },
      ],
    })

    await page.route('**/api/v1/receipts/*/reject', (route) => {
      try {
        const body = JSON.parse(route.request().postData() ?? '{}')
        rejectBodies.push(body)
      } catch {
        rejectBodies.push(route.request().postData())
      }
      void route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
    })

    await page.goto('/admin/review')
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })

    const deckContainer = page.locator('.relative.h-full').first()
    const box = await deckContainer.boundingBox()
    if (!box) throw new Error('Could not get deck bounding box')

    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 150, cy)
    await page.mouse.up()

    // Type a rejection reason into the sheet that should have appeared
    const reasonInput = page.getByRole('textbox', { name: /причина|reason|комментарий/i })
    await expect(reasonInput).toBeVisible({ timeout: 5_000 })
    await reasonInput.fill('Чек не читается, слишком размыт')

    // Submit the rejection
    await page.getByRole('button', { name: /отклонить/i }).last().click()

    await page.waitForTimeout(600)

    expect(rejectBodies.length, 'POST /reject should fire exactly once').toBe(1)
    expect(rejectBodies[0]).toMatchObject({ comment: 'Чек не читается, слишком размыт' })
  })

  /**
   * T2d — ReceiptDetailSheet "Отклонить" button fires reject POST.
   *
   * The detail sheet (opened on tap) has an "Отклонить" button.
   * It calls reject immediately (no reason prompt — same gap as T2b).
   * This test asserts the basic reject-from-sheet-button path works.
   */
  test('detail sheet Отклонить button fires reject POST', async ({ page }) => {
    const rejectRequests: string[] = []

    await mockAdminApi(page, {
      queueReceipts: [
        { id: '204', status: 'on_review', seller_name: 'Тест Детали', amount: 800 },
      ],
    })

    page.on('request', (req) => {
      if (req.url().includes('/reject') && req.method() === 'POST') {
        rejectRequests.push(req.url())
      }
    })

    // Mock the uiStore sheet — tap on the card opens the detail sheet.
    // The detail sheet renders buttons: Одобрить, Доработка, Отклонить.
    // We need to mock the sheet open endpoint: the sheet is opened via
    // useUiStore openSheet('detail', ...) which renders ReceiptDetailSheet.
    // The sheet overlay selector: look for the button text directly.

    await page.goto('/admin/review')
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })

    // Tap (click without drag) on the top card to open detail sheet
    const deckContainer = page.locator('.relative.h-full').first()
    await expect(deckContainer).toBeVisible({ timeout: 5_000 })

    const box = await deckContainer.boundingBox()
    if (!box) throw new Error('Could not get deck bounding box')

    // A simple click (no drag) triggers onTap → openSheet('detail', ...)
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    // The detail sheet should become visible with the Отклонить button
    // ReceiptDetailSheet renders a button with text "Отклонить"
    const rejectBtn = page.getByRole('button', { name: 'Отклонить' })
    await expect(rejectBtn).toBeVisible({ timeout: 8_000 })

    await rejectBtn.click()

    await page.waitForTimeout(600)

    expect(rejectRequests.length, 'POST /reject from sheet should fire once').toBeGreaterThan(0)
    expect(rejectRequests[0]).toContain('/receipts/204/reject')
  })
})
