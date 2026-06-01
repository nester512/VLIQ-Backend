import { defineConfig, devices } from '@playwright/test'

const CI = Boolean(process.env['CI'])

export default defineConfig({
  testDir: './e2e',

  // Give each test up to 30s; 60s on CI
  timeout: CI ? 60_000 : 30_000,

  // No retries locally; 2 retries in CI to handle flakiness
  retries: CI ? 2 : 0,

  // Run tests in parallel (each file gets its own worker)
  fullyParallel: true,

  // Fail fast in CI
  forbidOnly: CI,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    // Telegram WebApp SDK URL — block it so tests don't depend on external network
    // (the mock script below replaces the real SDK behaviour)
  },

  // Spin up the Vite dev server before running tests.
  // Port 4321 (--strictPort) avoids collision with Vite's default 5173 which
  // may be in use by another editor process on this machine.
  webServer: {
    command: 'npx vite --port 4321 --strictPort',
    url: 'http://localhost:4321',
    reuseExistingServer: !CI,
    timeout: 120_000,
  },

  projects: [
    {
      // Mobile phone — 402×844 (roughly iPhone 14)
      // Uses Chromium headless so we only need chromium installed.
      // `devices['iPhone 14']` would use WebKit; we keep the viewport but
      // force the browser to Chromium (only browser installed in this repo).
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
      // Tablet — 800×1280
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
      // Desktop — 1440×900
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
