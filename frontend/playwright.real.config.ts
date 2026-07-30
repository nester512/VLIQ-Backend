/**
 * playwright.real.config.ts — Real-backend E2E suite config.
 *
 * Runs tests in e2e-real/ against the pre-running docker-compose stack on
 * http://localhost:8080.  No webServer block — assumes stack is already up.
 *
 * USAGE:
 *   # Start stack (from repo root)
 *   docker compose up -d
 *
 *   # Run real-backend tests
 *   cd frontend && npm run e2e:real
 *
 *   # Run with Playwright UI
 *   cd frontend && npm run e2e:real:ui
 *
 * ADMIN SKIP NOTE:
 *   Admin specs (admin-review-flow, admin-payout-flow, admin-sellers-page) are
 *   automatically skipped unless VLIQ_ADMIN_AVAILABLE=true.  That env var is
 *   set by globalSetup only when /auth/login returns role='admin'|'super_admin'
 *   for id=809296638.  Currently the backend always returns role='seller', so all
 *   admin tests are skipped with a documented root cause.
 */

import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

const CI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: './e2e-real',

  globalSetup: resolve('./e2e-real/global-setup.ts'),

  timeout: CI ? 60_000 : 30_000,
  retries: CI ? 3 : 1,

  // Real backend — run serially to avoid state collisions between tests
  fullyParallel: false,
  workers: 1,

  forbidOnly: CI,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:8080',
    // NOTE: Do NOT add extraHTTPHeaders here — a custom header (e.g. X-E2E-Test)
    // triggers CORS preflight on cross-origin requests (e.g. Google Fonts) and the
    // external server's Access-Control-Allow-Headers won't include it, causing
    // console errors that break the smoke test.
    trace: 'on-first-retry',
    // No viewport here — each project overrides it
  },

  // No webServer — we assume the docker-compose stack is already running.

  projects: [
    {
      name: 'mobile-402',
      use: {
        browserName: 'chromium',
        viewport: { width: 402, height: 844 },
        userAgent: devices['iPhone 14']?.userAgent,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'tablet-800',
      use: {
        browserName: 'chromium',
        viewport: { width: 800, height: 1280 },
        userAgent: devices['iPad Mini']?.userAgent,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
