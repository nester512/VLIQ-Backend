/**
 * T6 — Admin approve flow
 *
 * Tests the admin review queue:
 *   - Admin sees the review queue with the expected receipt count
 *   - Swiping right (or triggering approve) fires the correct API call
 *   - Swiping left transitions to reject state
 *
 * All API calls are mocked via page.route().
 *
 * NOTE: SwipeDeck uses pointer events for swipe gestures.  Direct DOM swipe
 * simulation is reliable on desktop; on mobile viewports the touch target may
 * shift.  Tests marked .fixme() where a genuine UI gap exists.
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockAdminApi,
  MOCK_ADMIN_JWT,
} from './fixtures/telegram'

test.describe('Admin approve flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_ADMIN_JWT, 'admin')
  })

  test('admin sees review queue', async ({ page }) => {
    await mockAdminApi(page, {
      queueReceipts: [
        { id: '101', status: 'on_review', seller_name: 'Иван Иванов',   amount: 1200 },
        { id: '102', status: 'on_review', seller_name: 'Мария Смирнова', amount: 850  },
        { id: '103', status: 'pending',   seller_name: 'Алексей Морозов', amount: 560  },
      ],
    })

    await page.goto('/admin/review')

    // The SwipeDeck renders an <h1>Проверка чеков</h1> inside the deck
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })

    // Counter shows "1 / 3" (top card position / total)
    await expect(page.getByText(/1 \/ 3/)).toBeVisible({ timeout: 8_000 })
  })

  test('swiping right approves a receipt', async ({ page }) => {
    const approveRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/approve') && req.method() === 'POST') {
        approveRequests.push(req.url())
      }
    })

    await mockAdminApi(page, {
      queueReceipts: [
        { id: '101', status: 'on_review', seller_name: 'Иван Иванов', amount: 1200 },
      ],
    })

    await page.goto('/admin/review')
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/1 \/ 1/)).toBeVisible({ timeout: 5_000 })

    // Locate the top swipe card — it's a motion.div with position:absolute inset:0
    // The deck container has class "relative h-full".
    // We simulate a right swipe using pointer events on the card container.
    const deckContainer = page.locator('.relative.h-full').first()
    await expect(deckContainer).toBeVisible({ timeout: 5_000 })

    const box = await deckContainer.boundingBox()
    if (!box) throw new Error('Could not get deck container bounding box')

    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    // Swipe right: move 150px to the right (> THRESHOLD_X = 95px)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Move incrementally to trigger pointer move events
    await page.mouse.move(startX + 50, startY)
    await page.mouse.move(startX + 100, startY)
    await page.mouse.move(startX + 150, startY)
    await page.mouse.up()

    // Wait for the approve POST to fire (SwipeDeck calls onSwipe after 320ms animation)
    await page.waitForTimeout(500)

    expect(approveRequests.length, 'Expected POST /receipts/101/approve to be called').toBeGreaterThan(0)
    expect(approveRequests[0]).toContain('/receipts/101/approve')
  })

  test('swiping left triggers reject action', async ({ page }) => {
    const rejectRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/reject') && req.method() === 'POST') {
        rejectRequests.push(req.url())
      }
    })

    await mockAdminApi(page, {
      queueReceipts: [
        { id: '102', status: 'on_review', seller_name: 'Мария Смирнова', amount: 850 },
      ],
    })

    await page.goto('/admin/review')
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })

    const deckContainer = page.locator('.relative.h-full').first()
    await expect(deckContainer).toBeVisible({ timeout: 5_000 })

    const box = await deckContainer.boundingBox()
    if (!box) throw new Error('Could not get deck container bounding box')

    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    // Swipe left: move 150px to the left (> THRESHOLD_X = 95px in negative direction)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 50, startY)
    await page.mouse.move(startX - 100, startY)
    await page.mouse.move(startX - 150, startY)
    await page.mouse.up()

    // UX change: swipe-left now opens a RejectReasonSheet instead of firing immediately.
    // Complete the sheet flow to trigger the POST.
    const reasonInput = page.getByRole('textbox', { name: /причина|reason|комментарий/i })
    await expect(reasonInput).toBeVisible({ timeout: 5_000 })
    await reasonInput.fill('Тест отклонения')
    await page.getByRole('button', { name: /отклонить/i }).last().click()

    // Wait for the reject POST to fire
    await page.waitForTimeout(500)

    expect(rejectRequests.length, 'Expected POST /receipts/102/reject to be called').toBeGreaterThan(0)
    expect(rejectRequests[0]).toContain('/receipts/102/reject')
  })
})
