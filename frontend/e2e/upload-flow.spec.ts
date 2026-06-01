/**
 * T4 — Upload flow
 *
 * Tests the receipt image upload path:
 *   - Successful upload navigates to /seller/status/:id
 *   - Upload error shows friendly Russian message, not raw error code
 *
 * All API calls are mocked via page.route().
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockSellerApi,
  MOCK_SELLER_JWT,
} from './fixtures/telegram'

// Minimal 1×1 transparent PNG in binary — avoids fs dependency
const ONE_PX_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('Upload flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_SELLER_JWT, 'seller')
  })

  test('seller can upload image and lands on status page', async ({ page }) => {
    await mockSellerApi(page, { status: 'active', uploadReceiptId: 42, uploadStatus: 202 })
    await page.goto('/seller/upload')

    // Wait for the upload page to render
    await expect(page.getByText('Загрузите чек')).toBeVisible({ timeout: 10_000 })

    // Inject the 1×1 PNG into the hidden file input via setInputFiles.
    // The UploadPage has two hidden inputs: one for camera (accept="image/*" capture),
    // one for file (accept="image/*,application/pdf").  We target the latter.
    const fileInput = page.locator('input[type="file"]:not([capture])').first()
    await fileInput.setInputFiles({
      name: 'test-receipt.png',
      mimeType: 'image/png',
      buffer: ONE_PX_PNG,
    })

    // The preview image or file name should appear
    await expect(page.getByText('test-receipt.png')).toBeVisible({ timeout: 5_000 })

    // Click the "Отправить чек" button
    await page.getByRole('button', { name: 'Отправить чек' }).click()

    // Should navigate to /seller/status/42
    await expect(page).toHaveURL(/\/seller\/status\/42/, { timeout: 10_000 })

    // StatusPage <h2> shows "Чек получен" when status is pending
    // Use heading role to avoid strict mode violation (timeline also has "Чек получен" in <b>)
    await expect(page.getByRole('heading', { name: 'Чек получен' })).toBeVisible({ timeout: 8_000 })
  })

  test('upload errors show friendly message', async ({ page }) => {
    await mockSellerApi(page, {
      status: 'active',
      uploadStatus: 400,
      uploadError: {
        code: 'RECEIPT_UNSUPPORTED_TYPE',
        user_message: 'Этот формат не поддерживается',
        debug_id: 'e2e-debug-upload-001',
      },
    })

    await page.goto('/seller/upload')
    await expect(page.getByText('Загрузите чек')).toBeVisible({ timeout: 10_000 })

    // Inject a file to enable the submit button
    const fileInput = page.locator('input[type="file"]:not([capture])').first()
    await fileInput.setInputFiles({
      name: 'bad-file.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a receipt'),
    })

    await expect(page.getByRole('button', { name: 'Отправить чек' })).toBeEnabled({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Отправить чек' }).click()

    // Wait for toast / error state to appear
    // The useUploadReceipt hook calls pushToast on error — the toast renders in
    // the UI via uiStore.  The friendly message should appear.
    await expect(page.getByText('Ошибка загрузки чека')).toBeVisible({ timeout: 8_000 })

    // The raw error code MUST NOT be visible to the user
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('RECEIPT_UNSUPPORTED_TYPE')
  })
})
