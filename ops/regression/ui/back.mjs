// R-B-*: «назад» several steps deep through the real Telegram BackButton bridge. Exit 1 on a mismatch.
import { readFileSync } from 'node:fs'
import { chromium } from '/app/node_modules/playwright/index.mjs'

const ID = JSON.parse(readFileSync('/out/initdata.json', 'utf8'))
const BASE = process.env.BASE ?? 'https://test-nekuro.online'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true, locale: 'ru-RU' })
await ctx.addInitScript(() => {
  window.__back = []
  window.TelegramWebviewProxy = { postEvent(name, data) { if (name === 'web_app_setup_back_button') window.__back.push(JSON.parse(data || '{}').is_visible) } }
})
const page = await ctx.newPage()
const hash = new URLSearchParams({ tgWebAppData: ID.admin, tgWebAppVersion: '8.0', tgWebAppPlatform: 'android', tgWebAppThemeParams: '{}' }).toString()
await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

let fails = 0
async function expect(step, path, back) {
  await page.waitForTimeout(1500)
  const r = await page.evaluate(() => ({ path: location.pathname, back: window.__back.at(-1) ?? false }))
  const ok = r.path.startsWith(path) && r.back === back
  if (!ok) fails++
  console.log(ok ? 'ok   ' : 'FAIL ', step.padEnd(34), JSON.stringify(r))
}
const pressBack = () => page.evaluate(() => window.Telegram.WebView.receiveEvent('back_button_pressed'))

await expect('start: dashboard', '/admin/dash', false)
await page.getByRole('button', { name: /Продавцов/ }).first().click(); await expect('dash → Продавцов', '/admin/sellers', true)
await page.locator('.vliq-row').first().click(); await expect('→ seller', '/admin/sellers/', true)
await page.getByText('Выплаты продавца').click(); await expect('→ Выплаты продавца', '/admin/payouts', true)
await pressBack(); await expect('back → seller', '/admin/sellers/', true)
await pressBack(); await expect('back → Продавцы', '/admin/sellers', true)
await pressBack(); await expect('back → dashboard (root)', '/admin/dash', false)
await page.getByRole('button', { name: /Продавцов/ }).first().click(); await expect('dash → Продавцов', '/admin/sellers', true)
await page.locator('nav a', { hasText: 'Выплаты' }).click(); await expect('tab Выплаты (root)', '/admin/payouts', false)
await page.locator('.vliq-row').first().click(); await page.waitForTimeout(1200)
await page.locator('[role=dialog] .vliq-link').first().click(); await expect('payout card → seller', '/admin/sellers/', true)
await pressBack(); await expect('back → payouts', '/admin/payouts', false)
const sheetOpen = await page.locator('[role=dialog]').count()
if (!sheetOpen) fails++
console.log(sheetOpen ? 'ok   ' : 'FAIL ', 'payout card is open again after back')
await browser.close()
console.log(`BACK fails=${fails}`)
process.exit(fails ? 1 : 0)
