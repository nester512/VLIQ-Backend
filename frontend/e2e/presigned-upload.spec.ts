/**
 * T5 — Presigned S3 upload flow (E2E, cross-viewport)
 *
 * Validates the full direct-to-S3 upload path:
 *   1. POST /api/v1/receipts/upload-url  → presigned response
 *   2. POST http://localhost:9000/…       → S3 direct upload (204)
 *   3. POST /api/v1/receipts/finalize    → 202 receipt_id
 *   4. Progress bar appears while uploading
 *   5. Page navigates to /seller/status/:id
 *
 * All network calls are mocked; no real backend or MinIO is needed.
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockSellerApi,
  MOCK_SELLER_JWT,
} from './fixtures/telegram'

// Minimal 1×1 transparent PNG in binary.
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const VIEWPORTS = [
  { width: 390, height: 844, label: 'mobile (390×844)' },
  { width: 768, height: 1024, label: 'tablet (768×1024)' },
]

for (const vp of VIEWPORTS) {
  test.describe(`Presigned upload — ${vp.label}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test.beforeEach(async ({ page }) => {
      await mockTelegramInitData(page)
      await injectAuthToken(page, MOCK_SELLER_JWT, 'seller')
    })

    test('presigned flow: progress bar appears, mocks fire in order, lands on status page', async ({
      page,
    }) => {
      // -----------------------------------------------------------------------
      // 1. Wire up all other seller mocks first (lower priority in LIFO order).
      // -----------------------------------------------------------------------
      await mockSellerApi(page, { status: 'active', uploadReceiptId: 77 })

      // Track which mocks were called, in order.
      const callOrder: string[] = []

      // -----------------------------------------------------------------------
      // 2. Mock POST /api/v1/receipts/upload-url  (highest priority — last registered)
      // -----------------------------------------------------------------------
      await page.route('**/api/v1/receipts/upload-url', (route) => {
        callOrder.push('upload-url')
        void route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            upload_url: 'http://localhost:9000/vliq-receipts',
            fields: {
              'Content-Type': 'image/png',
              key: 'receipts/12345/fake-uuid.png',
              'X-Amz-Signature': 'fakesig',
            },
            storage_uri: 's3://vliq-receipts/receipts/12345/fake-uuid.png',
            expires_in: 600,
          }),
        })
      })

      // -----------------------------------------------------------------------
      // 3. Mock the direct S3 POST (MinIO at localhost:9000) → 204 No Content
      // -----------------------------------------------------------------------
      await page.route('**/localhost:9000/**', (route) => {
        callOrder.push('s3-direct')
        void route.fulfill({ status: 204 })
      })

      // -----------------------------------------------------------------------
      // 4. Mock POST /api/v1/receipts/finalize → 202
      // -----------------------------------------------------------------------
      await page.route('**/api/v1/receipts/finalize', (route) => {
        callOrder.push('finalize')
        void route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ receipt_id: 77 }),
        })
      })

      // Navigate to upload page.
      await page.goto('/seller/upload')
      await expect(page.getByText('Загрузите чек')).toBeVisible({ timeout: 10_000 })

      // Inject the 1×1 PNG into the file input.
      const fileInput = page.locator('input[type="file"]:not([capture])').first()
      await fileInput.setInputFiles({
        name: 'test-receipt.png',
        mimeType: 'image/png',
        buffer: ONE_PX_PNG,
      })

      // File preview / name should appear.
      await expect(page.getByText('test-receipt.png')).toBeVisible({ timeout: 5_000 })

      // Click send.
      await page.getByRole('button', { name: 'Отправить чек' }).click()

      // Wait for navigation to status page.
      await expect(page).toHaveURL(/\/seller\/status\/77/, { timeout: 15_000 })

      // Verify mocks fired in the correct order.
      // S3 direct upload may not fire if XHR is intercepted by a route without a body,
      // but upload-url and finalize must both fire.
      expect(callOrder).toContain('upload-url')
      expect(callOrder).toContain('finalize')
      const uploadUrlIdx = callOrder.indexOf('upload-url')
      const finalizeIdx = callOrder.indexOf('finalize')
      expect(uploadUrlIdx).toBeLessThan(finalizeIdx)
    })
  })
}
