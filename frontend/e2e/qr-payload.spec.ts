/**
 * T5 — QR payload flow
 *
 * Tests that pasting / triggering a QR string fires POST /receipts/qr-payload
 * and navigates to the status page.
 *
 * UploadPage uses window.Telegram.WebApp.showScanQrPopup to trigger the native
 * scanner.  When that API is absent (web / no TMA), clicking the QR button
 * falls back to opening the file picker (fileRef.current?.click()).
 *
 * In our tests we simulate the QR result by calling the page.evaluate()
 * callback that the mock stub would call, bypassing the native scanner.
 * Specifically: the mock Telegram.WebApp.showScanQrPopup is overridden in
 * addInitScript so it immediately calls the callback with the mock QR string
 * (simulating a user scanning a QR code).
 */

import { test, expect } from '@playwright/test'
import {
  mockTelegramInitData,
  injectAuthToken,
  mockSellerApi,
  MOCK_SELLER_JWT,
} from './fixtures/telegram'

// Russian fiscal QR format per FNS (Federal Tax Service of Russia):
// t=<date>T<time>&s=<sum>&fn=<fn>&fd=<fd>&fp=<fp>&n=<doc_type>
const MOCK_QR_STRING = 't=20260101T1200&s=1234.56&fn=1111111111111111&fd=999999&fp=1234567890&n=1'

test.describe('QR payload flow', () => {
  test.beforeEach(async ({ page }) => {
    // Install Telegram mock WITH a QR scanner override: when showScanQrPopup
    // is called, immediately invoke the callback with our mock QR string.
    // This must be done BEFORE injectAuthToken so addInitScript ordering is correct.
    await mockTelegramInitData(page)

    // Override showScanQrPopup to auto-trigger callback with our test QR
    await page.addInitScript((qrString: string) => {
      // Runs after mockTelegramInitData's stub is defined, so we can extend it.
      const doOverride = () => {
        const tg = (window as Window & { Telegram?: { WebApp?: Record<string, unknown> } }).Telegram?.WebApp
        if (tg) {
          tg['showScanQrPopup'] = (_opts: unknown, cb?: (data: string) => void) => {
            // Simulate successful QR scan
            if (cb) cb(qrString)
          }
        }
      }
      // Try immediately, then on DOMContentLoaded in case the stub isn't yet set
      doOverride()
      document.addEventListener('DOMContentLoaded', doOverride)
    }, MOCK_QR_STRING)

    await injectAuthToken(page, MOCK_SELLER_JWT, 'seller')
  })

  test('pasting a valid Russian QR string fires POST /receipts/qr-payload', async ({ page }) => {
    // Track the QR payload request
    const qrRequests: { url: string; body: string }[] = []
    page.on('request', (req) => {
      if (req.url().includes('/receipts/qr-payload') && req.method() === 'POST') {
        qrRequests.push({ url: req.url(), body: req.postData() ?? '' })
      }
    })

    await mockSellerApi(page, { status: 'active', qrReceiptId: 43 })
    await page.goto('/seller/upload')

    await expect(page.getByText('Загрузите чек')).toBeVisible({ timeout: 10_000 })

    // Click the QR button — with our stub, showScanQrPopup fires callback immediately
    await page.getByRole('button', { name: 'QR-код' }).click()

    // The QR code should now be shown in the upload box ("QR-код отсканирован")
    await expect(page.getByText('QR-код отсканирован')).toBeVisible({ timeout: 5_000 })

    // Send the receipt
    await page.getByRole('button', { name: 'Отправить чек' }).click()

    // Should navigate to status page
    await expect(page).toHaveURL(/\/seller\/status\/43/, { timeout: 10_000 })
    // StatusPage <h2> shows the primary status — use heading role to avoid
    // strict mode violation (timeline also renders "Чек получен" in a <b>).
    await expect(page.getByRole('heading', { name: 'Чек получен' })).toBeVisible({ timeout: 8_000 })

    // The POST request body should contain the QR string
    expect(qrRequests.length, 'Expected POST /receipts/qr-payload to be called').toBeGreaterThan(0)
    const lastBody = qrRequests[qrRequests.length - 1].body
    expect(lastBody).toContain('qr_raw')
    expect(lastBody).toContain('20260101T1200')
  })
})
