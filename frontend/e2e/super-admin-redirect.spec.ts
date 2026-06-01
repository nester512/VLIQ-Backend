/**
 * T3 — Super_admin role redirect
 *
 * Verifies that a user with role='super_admin' is treated identically to
 * role='admin' by the frontend:
 *   - RoleRedirect (AuthGate.tsx line 97) sends both 'admin' and 'super_admin'
 *     to /admin/dash.
 *   - All admin-only routes (/admin/dash, /admin/review, /admin/payouts,
 *     /admin/sellers) are accessible without redirect-to-/.
 *
 * IMPLEMENTATION NOTE:
 * MOCK_SUPER_ADMIN_JWT is defined in e2e/fixtures/telegram.ts (line 88,
 * added as part of T3).  It uses the existing makeDummyJwt helper with
 * role='super_admin' and sub='88888'.
 *
 * TODO: If a parallel agent adds super-admin-only routes (e.g. /admin/config,
 * /admin/brands), add matching navigation assertions here.  Don't depend on
 * backend changes that may not have landed yet.
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockAdminApi,
  MOCK_SUPER_ADMIN_JWT,
} from './fixtures/telegram'

test.describe('Super admin role redirect', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_SUPER_ADMIN_JWT, 'super_admin')
    // Provide admin API mocks so pages can load without real backend
    await mockAdminApi(page)
  })

  test('super_admin lands on /admin/dash', async ({ page }) => {
    // Navigate to / — RoleRedirect should redirect super_admin to /admin/dash
    await page.goto('/')

    // RoleRedirect in AuthGate.tsx: role === 'super_admin' → Navigate to /admin/dash
    await expect(page).toHaveURL(/\/admin\/dash/, { timeout: 10_000 })

    // DashPage renders an <h1>Сводка</h1> heading
    await expect(page.getByRole('heading', { name: 'Сводка' })).toBeVisible({ timeout: 10_000 })
  })

  test('super_admin has access to /admin/review', async ({ page }) => {
    await page.goto('/admin/review')

    // Should load the review queue, not redirect to /
    await expect(page).toHaveURL(/\/admin\/review/, { timeout: 10_000 })
    await expect(page.getByRole('heading', { name: 'Проверка чеков' })).toBeVisible({ timeout: 10_000 })
  })

  test('super_admin has access to /admin/payouts', async ({ page }) => {
    await page.goto('/admin/payouts')

    // Should stay on /admin/payouts, not redirect to /
    await expect(page).toHaveURL(/\/admin\/payouts/, { timeout: 10_000 })
    // PayoutsPage renders some content — just assert we're not kicked back to /
    await expect(page).not.toHaveURL(/^\/$/, { timeout: 5_000 })
  })

  test('super_admin has access to /admin/sellers', async ({ page }) => {
    await page.goto('/admin/sellers')

    // Should stay on /admin/sellers, not redirect to /
    await expect(page).toHaveURL(/\/admin\/sellers/, { timeout: 10_000 })
    await expect(page).not.toHaveURL(/^\/$/, { timeout: 5_000 })
  })

  test('super_admin is NOT redirected to /seller', async ({ page }) => {
    // Confirm super_admin never ends up in the seller section
    await page.goto('/')
    await expect(page).not.toHaveURL(/\/seller/, { timeout: 8_000 })
  })
})
