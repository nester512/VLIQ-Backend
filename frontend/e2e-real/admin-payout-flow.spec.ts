/**
 * admin-payout-flow.spec.ts — Real-backend admin payout approval.
 *
 * Requires admin JWT (VLIQ_ADMIN_AVAILABLE=true from globalSetup).
 *
 * NOTE: Tests run serially across 3 viewports. Earlier viewports may approve
 * the seeded 'new' payout requests. This test gracefully skips the approval
 * step if no 'new' payouts remain and verifies the page renders without error.
 *
 * Desktop-only.
 */

import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './fixtures/auth'

const BASE = 'http://localhost:8080'
const ADMIN_AVAILABLE = process.env['VLIQ_ADMIN_AVAILABLE'] === 'true'

test.describe('admin-payout-flow (real backend)', () => {
  test('payouts page loads; if new requests exist, approve first and verify status flipped', async ({ page }) => {
    test.skip(!ADMIN_AVAILABLE, 'SKIP: admin JWT unavailable — globalSetup did not receive role=admin|super_admin')

    await loginAsAdmin(page)

    await page.goto('/admin/payouts')
    await expect(page).toHaveURL(/\/admin\/payouts/, { timeout: 10_000 })

    // Page renders the "К выплате" metric card when data loads
    await expect(page.getByText('К выплате')).toBeVisible({ timeout: 15_000 })

    // Check via backend API
    const token = process.env['VLIQ_ADMIN_JWT']!
    const listRes = await fetch(`${BASE}/api/v1/payout-requests?status=new&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(listRes.status).toBe(200)
    const listData = (await listRes.json()) as { items: Array<{ id: number; status: string }> }

    if (listData.items.length === 0) {
      // Earlier viewport runs approved all 'new' payouts — verify page renders OK
      const bodyText = await page.locator('body').innerText()
      expect(bodyText).not.toMatch(/\{"detail":/)
      console.log('[admin-payout-flow] No "new" payout requests remain (consumed by earlier viewport) — skip approve step')
      return
    }

    const firstPayout = listData.items[0]!

    // Approve via backend API
    const approveRes = await fetch(`${BASE}/api/v1/payout-requests/${firstPayout.id}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(approveRes.status, `approve returned ${approveRes.status}`).toBeGreaterThanOrEqual(200)
    expect(approveRes.status).toBeLessThan(300)

    // Verify status flipped
    const checkRes = await fetch(`${BASE}/api/v1/payout-requests/${firstPayout.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(checkRes.status).toBe(200)
    const checkData = (await checkRes.json()) as { status: string }
    expect(checkData.status, `payout ${firstPayout.id} should no longer be "new"`).not.toBe('new')
  })
})
