/**
 * seller-upload-qr.spec.ts — Real-backend receipt status flow.
 *
 * Fetches the seller's real receipt list via /sellers/me/receipts to find a
 * valid receipt id dynamically (avoids hardcoded IDs that change on re-seed).
 * The POST /receipts/qr-payload path is noted as broken (backend UniqueViolation
 * on file_hash='') — we work around it by using seeded receipts.
 *
 * Viewport projects: mobile-402, desktop-1440
 */

import { test, expect } from '@playwright/test'
import { loginAsSeller } from './fixtures/auth'

const BASE = 'http://localhost:8080'

/** Returns the id of the first non-approved receipt (on_review / pending) for seller. */
async function getActiveReceiptId(): Promise<number | null> {
  const token = process.env['VLIQ_SELLER_JWT']
  if (!token) return null
  const res = await fetch(`${BASE}/api/v1/sellers/me/receipts`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { items: Array<{ id: number; status: string }> }
  // Prefer on_review, then pending, then any receipt
  const onReview = data.items.find((r) => r.status === 'on_review')
  if (onReview) return onReview.id
  const pending = data.items.find((r) => r.status === 'pending')
  if (pending) return pending.id
  return data.items[0]?.id ?? null
}

test.describe('seller-upload-qr (real backend)', () => {
  test('navigates to /seller/status/:id and shows receipt status', async ({ page }) => {
    const receiptId = await getActiveReceiptId()
    if (!receiptId) {
      test.skip(true, 'No seeded receipts found for seller 12345 — re-run seed_dev.sql')
      return
    }

    await loginAsSeller(page)
    await page.goto(`/seller/status/${receiptId}`)

    // Page should render without redirect
    await expect(page).toHaveURL(new RegExp(`/seller/status/${receiptId}`), {
      timeout: 10_000,
    })

    // Status page must show the main heading — use .first() to handle timeline rows
    // that also contain e.g. "Чек получен" as a timeline step label.
    await expect(
      page.getByText(/Чек на проверке|Чек получен|Чек одобрен|Нужны правки|Чек отклонён|Данные распознаём|Распознаём данные/).first(),
    ).toBeVisible({ timeout: 10_000 })

    // Timeline section must be present
    await expect(page.getByText('Статус обработки')).toBeVisible({ timeout: 8_000 })
  })

  test('GET /receipts/:id/status returns non-null status via API', async ({ page }) => {
    const receiptId = await getActiveReceiptId()
    if (!receiptId) {
      test.skip(true, 'No seeded receipts found — re-run seed_dev.sql')
      return
    }

    await loginAsSeller(page)

    // Verify backend directly via page.evaluate (uses the real JWT from localStorage)
    const statusRes = await page.evaluate(async (id: number) => {
      const token = (JSON.parse(localStorage.getItem('vliq-auth') ?? '{}') as { state?: { token?: string } })?.state?.token ?? ''
      const r = await fetch(`/api/v1/receipts/${id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return { status: r.status, body: await r.json() as { status: string } }
    }, receiptId)

    expect(statusRes.status).toBe(200)
    expect(statusRes.body.status).toBeTruthy()

    const knownStatuses = ['pending', 'ocr_in_progress', 'on_review', 'needs_revision', 'approved', 'paid_out', 'rejected']
    expect(knownStatuses).toContain(statusRes.body.status)
  })

  test('status transitions: on_review receipt is not "pending" (already past intake)', async ({ page }) => {
    const token = process.env['VLIQ_SELLER_JWT']
    if (!token) {
      test.skip(true, 'VLIQ_SELLER_JWT not set')
      return
    }

    // Fetch on_review receipt directly
    const res = await fetch(`${BASE}/api/v1/sellers/me/receipts`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = (await res.json()) as { items: Array<{ id: number; status: string }> }
    const onReview = data.items.find((r) => r.status === 'on_review')

    if (!onReview) {
      test.skip(true, 'No on_review receipt in seed — skipping transition check')
      return
    }

    await loginAsSeller(page)

    const statusRes = await page.evaluate(async (id: number) => {
      const token = (JSON.parse(localStorage.getItem('vliq-auth') ?? '{}') as { state?: { token?: string } })?.state?.token ?? ''
      const r = await fetch(`/api/v1/receipts/${id}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return (await r.json()) as { status: string }
    }, onReview.id)

    // on_review receipt should NOT be 'pending' (it has moved forward)
    expect(statusRes.status).not.toBe('pending')
    expect(statusRes.status).toBe('on_review')
  })
})
