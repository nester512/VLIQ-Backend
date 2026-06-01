/**
 * T3 — Registration flow
 *
 * Tests the seller registration flow:
 *   - Pending seller is gated to /seller/reg
 *   - Submitting a valid form transitions to active
 *   - Form validation shows friendly Russian errors
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

test.describe('Registration flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockTelegramInitData(page)
    await injectAuthToken(page, MOCK_SELLER_JWT, 'seller')
  })

  test('pending seller is forced to /seller/reg', async ({ page }) => {
    await mockSellerApi(page, { status: 'pending' })

    // Navigate to home — SellerProfileGate should redirect to /seller/reg
    await page.goto('/seller/home')

    // Wait for the redirect and the registration page heading
    await expect(page).toHaveURL(/\/seller\/reg/, { timeout: 10_000 })
    await expect(page.getByText('Расскажите о себе')).toBeVisible({ timeout: 8_000 })
  })

  test('submitting valid form fires PATCH /sellers/me and transitions to active', async ({ page }) => {
    // Start as pending — reg form is shown
    await mockSellerApi(page, { status: 'pending' })

    // Track the PATCH request
    const patchRequests: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes('/sellers/me')) {
        patchRequests.push(req.url())
      }
    })

    await page.goto('/seller/reg')
    await expect(page.getByText('Расскажите о себе')).toBeVisible({ timeout: 10_000 })

    // Step 1: fill personal info
    await page.getByLabel('Имя').fill('Алексей')
    await page.getByLabel('Фамилия').fill('Морозов')

    // Phone field — use label text match
    const phoneInput = page.locator('input[type="tel"]')
    await phoneInput.fill('+79001234567')
    await phoneInput.blur()

    await page.getByLabel('Город').fill('Москва')

    // Click "Далее" to go to step 2
    await page.getByRole('button', { name: 'Далее' }).click()

    // Step 2: fill store + payout info
    await expect(page.getByLabel('Торговая точка')).toBeVisible({ timeout: 5_000 })
    await page.getByLabel('Торговая точка').fill('Дымов · ТЦ Авиапарк')

    // Select payout method: СБП
    await page.getByRole('button', { name: 'СБП' }).first().click()

    // Fill payout details
    await page.getByLabel('Номер телефона для СБП').fill('+79001234567')

    // Check consent
    const consentCheckbox = page.getByRole('checkbox')
    await consentCheckbox.click()

    // Submit
    await page.getByRole('button', { name: 'Завершить регистрацию' }).click()

    // Should navigate to /seller/home after successful registration
    await expect(page).toHaveURL(/\/seller\/home/, { timeout: 10_000 })

    // The PATCH request should have been fired
    expect(patchRequests.length, 'Expected PATCH /sellers/me to be called').toBeGreaterThan(0)
  })

  test('form validation: empty phone shows friendly error', async ({ page }) => {
    await mockSellerApi(page, { status: 'pending' })
    await page.goto('/seller/reg')
    await expect(page.getByText('Расскажите о себе')).toBeVisible({ timeout: 10_000 })

    // Fill name and city but leave phone empty
    await page.getByLabel('Имя').fill('Алексей')
    await page.getByLabel('Фамилия').fill('Морозов')
    await page.getByLabel('Город').fill('Москва')

    // Focus and blur the phone field without entering a value — triggers the
    // touched state and switches the hint text from informational grey to error red.
    const phoneInput = page.locator('input[type="tel"]')
    await phoneInput.focus()
    await phoneInput.blur()

    // The phone error text "Формат: +7XXXXXXXXXX" should be visible in error state.
    // RegPage shows this as a red <p> when touched.phone && errors.phone.
    await expect(page.getByText('Формат: +7XXXXXXXXXX')).toBeVisible({ timeout: 5_000 })

    // The "Далее" button should remain disabled because step1Valid === false.
    // This is intentional design — the button is disabled, not hidden.
    await expect(page.getByRole('button', { name: 'Далее' })).toBeDisabled()

    // Raw Pydantic error strings MUST NOT be visible
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toMatch(/string_type/)
    expect(bodyText).not.toMatch(/value_error/)
    expect(bodyText).not.toMatch(/"detail"/)
  })
})
