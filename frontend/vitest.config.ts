import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Vitest config kept separate from vite.config.ts so the Tailwind plugin
// (which scans CSS at build time) doesn't run during unit tests.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Unit tests live in src/. The e2e/ and e2e-real/ dirs hold Playwright
    // specs (*.spec.ts) that must NOT be collected by vitest.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**', 'e2e-real/**'],
  },
})
