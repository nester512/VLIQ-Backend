/**
 * admin-sellers-page.spec.ts — Real-backend admin sellers page.
 *
 * Requires admin JWT (VLIQ_ADMIN_AVAILABLE=true from globalSetup).
 *
 * 3 viewport projects: mobile-402 / tablet-800 / desktop-1440
 */

import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './fixtures/auth'

const ADMIN_AVAILABLE = process.env['VLIQ_ADMIN_AVAILABLE'] === 'true'

test.describe('admin-sellers-page (real backend)', () => {
  test.beforeEach(async () => {
    test.skip(!ADMIN_AVAILABLE, 'SKIP: admin JWT unavailable — globalSetup did not receive role=admin|super_admin')
  })

  test('search input present + focusable; "12345" filters to show Алексей Морозов', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/sellers')
    await expect(page).toHaveURL(/\/admin\/sellers/, { timeout: 10_000 })

    // Search bar must be present
    const searchInput = page.getByPlaceholder('Поиск продавца')
    await expect(searchInput).toBeVisible({ timeout: 10_000 })
    await expect(searchInput).toBeEnabled()

    await searchInput.focus()
    await expect(searchInput).toBeFocused()

    await searchInput.fill('12345')
    // Wait for debounced request to resolve
    await page.waitForTimeout(800)

    // Seller 12345 (Алексей Морозов) should appear
    await expect(page.getByText('Алексей').first()).toBeVisible({ timeout: 10_000 })
  })

  test('click seller row → detail sheet opens with Баланс and Чеков values', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/sellers')
    await expect(page).toHaveURL(/\/admin\/sellers/, { timeout: 10_000 })

    // Wait for list to load
    await expect(page.getByRole('button').filter({ hasText: 'Алексей' }).first()).toBeVisible({ timeout: 10_000 })

    // Click seller row (Алексей Морозов / 12345)
    await page.getByRole('button').filter({ hasText: 'Алексей' }).first().click()

    // Detail sheet should open — KV rows must be visible
    await expect(page.getByText('Баланс')).toBeVisible({ timeout: 8_000 })
    await expect(page.getByText('Чеков всего')).toBeVisible({ timeout: 8_000 })

    // The "К чекам" navigation button must be present and enabled
    await expect(page.getByRole('button', { name: /к чекам/i })).toBeVisible({ timeout: 5_000 })
    await expect(page.getByRole('button', { name: /к чекам/i })).toBeEnabled()
  })

  test('click "К чекам" button → navigates to /admin/sellers/12345/receipts with non-empty list', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/sellers')

    // Wait for list
    await expect(page.getByRole('button').filter({ hasText: 'Алексей' }).first()).toBeVisible({ timeout: 10_000 })

    // Open Алексей Морозов detail sheet
    await page.getByRole('button').filter({ hasText: 'Алексей' }).first().click()

    // Detail sheet: click "К чекам" button
    const kChekamBtn = page.getByRole('button', { name: /к чекам/i })
    await expect(kChekamBtn).toBeVisible({ timeout: 8_000 })
    await kChekamBtn.click()

    await page.waitForURL(/\/admin\/sellers\/12345\/receipts/, { timeout: 10_000 })

    // List should be non-empty (seeded receipts for seller 12345)
    await expect(page.locator('.vliq-row').first()).toBeVisible({ timeout: 10_000 })
  })
})
