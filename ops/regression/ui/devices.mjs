// R-L-D*: every screen of both roles on 20 device sizes (phones, a folding cover, landscape, tablets,
// the Telegram Desktop window, laptops) in the engine each Telegram client really uses:
// Android / Telegram Desktop / Web A → Chromium, iOS / macOS → WebKit, Web K in Firefox → Firefox.
// Per device: layout detectors (lib.detect), the navigation shape (bottom tab bar on phones, side menu
// from 768 px), the review deck's buttons fit the screen, «назад» two levels deep, and the QR start of
// the upload screen per platform (native Telegram scanner only on Android / iOS).
// Usage: ENGINE=chromium|webkit|firefox node devices.mjs — exit 1 on any finding.
import { appendFileSync } from 'node:fs'
import { chromium, webkit, firefox } from '/app/node_modules/playwright/index.mjs'
import { BASE, ID, detect, settle } from '/out/lib.mjs'

// Like the router's own push: a numbered history entry (lib.nav pushes `{}`, which the back-stack
// logic reads as depth 0 — fine for one-screen checks, wrong for «назад»).
async function nav(page, path) {
  await page.evaluate((p) => {
    const idx = (typeof history.state?.idx === 'number' ? history.state.idx : 0) + 1
    history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, '', p)
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, path)
  await settle(page)
}

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Telegram-Android/11.5.0',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  tdesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/6.7 Chrome/118.0 Safari/537.36',
  macos: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  weba: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  webk: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
}
const ENGINE_OF = { android: 'chromium', tdesktop: 'chromium', weba: 'chromium', ios: 'webkit', macos: 'webkit', webk: 'firefox' }
const MOBILE = new Set(['android', 'ios'])
// [name, width, height, platform, theme]
export const DEVICES = [
  ['iphone-se1', 320, 568, 'ios', 'light'],
  ['fold-cover', 344, 882, 'android', 'dark'],
  ['android-360x640', 360, 640, 'android', 'light'],
  ['iphone-se', 375, 667, 'ios', 'dark'],
  ['iphone-14', 390, 844, 'ios', 'light'],
  ['pixel-8', 393, 852, 'android', 'dark'],
  ['android-412', 412, 915, 'android', 'light'],
  ['iphone-pro-max', 430, 932, 'ios', 'dark'],
  ['iphone-landscape', 844, 390, 'ios', 'light'],
  ['tdesktop-window', 400, 700, 'tdesktop', 'dark'],
  ['android-tablet', 600, 960, 'android', 'light'],
  ['ipad-mini', 768, 1024, 'ios', 'dark'],
  ['ipad-air', 820, 1180, 'ios', 'light'],
  ['ipad-pro', 1024, 1366, 'ios', 'dark'],
  ['laptop-1280x720', 1280, 720, 'tdesktop', 'light'],
  ['macbook-1280x800', 1280, 800, 'macos', 'dark'],
  ['laptop-1366x768', 1366, 768, 'weba', 'light'],
  ['macbook-1440x900', 1440, 900, 'macos', 'light'],
  ['laptop-1536x864', 1536, 864, 'weba', 'dark'],
  ['desktop-1920x1080', 1920, 1080, 'webk', 'light'],
]
const THEMES = {
  dark: { bg_color: '#212121', secondary_bg_color: '#181818', text_color: '#ffffff', hint_color: '#aaaaaa', link_color: '#8774e1', button_color: '#8774e1', button_text_color: '#ffffff' },
  light: { bg_color: '#ffffff', secondary_bg_color: '#f4f4f5', text_color: '#000000', hint_color: '#707579', link_color: '#3390ec', button_color: '#3390ec', button_text_color: '#ffffff' },
}
const S = ID.seller_id
const ADMIN = [['dash', '/admin/dash'], ['review', '/admin/review'], ['receipts', '/admin/receipts?sort=sum'], ['payouts', '/admin/payouts'],
  ['sellers', '/admin/sellers'], ['seller', `/admin/sellers/${S}/receipts?sort=bonus`]]
const SELLER = [['home', '/seller/home'], ['upload', '/seller/upload'], ['history', '/seller/history'], ['balance', '/seller/balance'],
  ['payout', '/seller/payout'], ['payouts', '/seller/payouts'], ['promo', '/seller/promo'], ['profile', '/seller/profile']]

const ENGINE = process.env.ENGINE ?? 'chromium'
const LAUNCH = { chromium, webkit, firefox }[ENGINE]
const LOG = `/out/devices-${ENGINE}.jsonl`
let issues = 0
const rec = (o) => appendFileSync(LOG, JSON.stringify(o) + '\n')
function issue(where, what) { issues++; console.log('ISSUE', where, JSON.stringify(what).slice(0, 900)); rec({ where, issue: what }) }
const expectedAbort = (r) => /\/receipts\/review-events/.test(r.url()) && /ABORT|cancel|NS_BINDING_ABORTED|Load request cancelled/i.test(r.failure()?.errorText ?? '')

async function openApp(browser, account, platform, theme, w, h) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme, locale: 'ru-RU', userAgent: UA[platform],
    hasTouch: MOBILE.has(platform), ...(ENGINE !== 'firefox' && MOBILE.has(platform) ? { isMobile: true } : {}),
  })
  await ctx.addInitScript(() => {
    window.__ev = []
    window.TelegramWebviewProxy = { postEvent(name, data) { window.__ev.push([name, data ? JSON.parse(data) : null]) } }
  })
  const page = await ctx.newPage()
  page._errs = []
  page.on('console', (m) => { if (m.type() === 'error' && !/review-events/.test(m.text())) page._errs.push(`console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => page._errs.push(`pageerror: ${String(e).slice(0, 300)}`))
  page.on('response', (r) => { if (r.status() >= 400) page._errs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/tgWebAppData=[^&]*/, 'tgWebAppData=…').slice(0, 200)}`) })
  page.on('requestfailed', (r) => { if (!/telemetry|analytics|favicon/.test(r.url()) && !expectedAbort(r)) page._errs.push(`FAILED ${r.method()} ${r.url().slice(0, 160)} ${r.failure()?.errorText}`) })
  const hash = new URLSearchParams({ tgWebAppData: ID[account], tgWebAppVersion: '8.0', tgWebAppPlatform: platform, tgWebAppThemeParams: JSON.stringify(THEMES[theme]) }).toString()
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  return page
}

// Phones: horizontal tab bar inside the screen at the bottom. From 768 px: vertical side menu, no bottom bar.
async function navShape(page) {
  return page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' }
    const vert = [...document.querySelectorAll('.vliq-tabbar--vertical')].filter(vis)
    const bars = [...document.querySelectorAll('nav')].filter(vis).filter((n) => !n.classList.contains('vliq-tabbar--vertical'))
    const vh = innerHeight
    return {
      vertical: vert.length,
      sideItemH: Math.max(0, ...vert.flatMap((n) => [...n.querySelectorAll('a')].map((a) => Math.round(a.getBoundingClientRect().height)))),
      bottomBar: bars.filter((n) => { const r = n.getBoundingClientRect(); return r.bottom > vh - 120 }).length,
      barInside: bars.every((n) => { const r = n.getBoundingClientRect(); return r.bottom <= vh + 1 && r.top >= 0 }),
    }
  })
}

// The deck's action buttons (Одобрить / Отклонить / Пропустить) must be reachable without scrolling the page.
async function deckFits(page) {
  return page.evaluate(() => {
    const vh = innerHeight
    const btns = [...document.querySelectorAll('button')].filter((b) => /Одобрить|Отклонить|Пропустить/.test(b.getAttribute('aria-label') || b.innerText || ''))
      .filter((b) => b.getBoundingClientRect().width > 0)
    // the risk chips and «Подробнее» must not be cut off by the card on a short screen
    const cut = []
    for (const sum of document.querySelectorAll('[data-testid=review-card-summary]')) {
      const card = sum.parentElement.getBoundingClientRect()
      for (const el of [sum.querySelector('.vliq-review-summary__chips'), sum.querySelector('.vliq-review-summary__details')]) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.bottom > card.bottom + 1 || r.top < card.top - 1) cut.push(el.className.split(' ')[0].replace('vliq-review-summary__', ''))
      }
    }
    return { buttons: btns.length, cut: [...new Set(cut)], offscreen: btns.filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > vh + 1 || r.top < 0 }).map((b) => (b.getAttribute('aria-label') || b.innerText).trim().slice(0, 30)) }
  })
}

const backState = (page) => page.evaluate(() => ({ path: location.pathname, back: window.__ev.filter(([n]) => n === 'web_app_setup_back_button').at(-1)?.[1]?.is_visible ?? false }))
const pressBack = (page) => page.evaluate(() => window.Telegram.WebView.receiveEvent('back_button_pressed'))

const browser = await LAUNCH.launch()
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null // e.g. ONLY=laptop — a subset of devices
const mine = DEVICES.filter(([d, , , p]) => ENGINE_OF[p] === ENGINE && (!ONLY || ONLY.test(d)))
const byPlatform = Object.groupBy(mine, ([, , , p]) => p)
for (const [platform, devices] of Object.entries(byPlatform)) for (const theme of ['light', 'dark']) {
  const list = devices.filter(([, , , , t]) => t === theme)
  if (!list.length) continue
  for (const [account, pages] of [['admin', ADMIN], ['seller', SELLER]]) {
    const [, w0, h0] = list[0]
    const page = await openApp(browser, account, platform, theme, w0, h0)
    const ev0 = await page.evaluate(() => window.__ev.map(([n]) => n))
    if (!ev0.includes('web_app_ready')) issue(`${platform} ${account} boot`, { missing: 'web_app_ready', events: ev0 })
    if (ev0.some((n) => n === 'web_app_expand') === false && MOBILE.has(platform)) rec({ where: `${platform} ${account} boot`, note: 'no web_app_expand', events: ev0 })
    for (const [dev, w, h] of list) {
      await page.setViewportSize({ width: w, height: h })
      await page.waitForTimeout(500)
      const where = (n) => `${ENGINE} ${dev} ${w}x${h} ${platform} ${theme} ${account} ${n}`
      for (const [name, path] of pages) {
        page._errs.length = 0
        await nav(page, path)
        const r = await detect(page)
        const errs = page._errs.filter((e) => !/favicon|telemetry/.test(e))
        const shape = await navShape(page)
        const wide = w >= 768
        // side menu items keep their own height (a stretched item was a quarter of the screen)
        const navBad = wide ? (shape.vertical !== 1 || shape.bottomBar !== 0 || shape.sideItemH > 64) : (shape.vertical !== 0 || shape.bottomBar !== 1 || !shape.barInside)
        const found = { overflowX: r.overflowX, clipped: r.clipped, beyond: r.beyond, overlaps: name === 'review' ? [] : r.overlaps, garbage: r.garbage, errs, ...(navBad ? { nav: shape } : {}) }
        if (name === 'review') { const d = await deckFits(page); if (d.offscreen.length || d.cut.length) found.deck = d }
        const bad = found.overflowX || found.clipped.length || found.beyond.length || found.overlaps.length || found.garbage.length || errs.length || found.nav || found.deck
        if (bad) issue(where(name), found)
        else console.log('ok   ', where(name))
        rec({ where: where(name), ok: !bad })
        await page.screenshot({ path: `/out/shots/dev-${dev}-${account}-${name}.png` })
      }
      if (account === 'admin') {
        // «назад»: tab «Обзор» (a root) → Продавцы → карточка продавца → назад → назад
        const steps = []
        try {
          await page.locator('nav a', { hasText: 'Обзор' }).first().click(); await settle(page, 800)
          await page.getByRole('button', { name: /Продавцов/ }).first().click(); await settle(page, 800); steps.push(await backState(page))
          await page.locator('.vliq-row').first().click(); await settle(page, 800); steps.push(await backState(page))
          await pressBack(page); await settle(page, 800); steps.push(await backState(page))
          await pressBack(page); await settle(page, 800); steps.push(await backState(page))
        } catch (e) { steps.push({ error: String(e).slice(0, 200) }) }
        const want = [['/admin/sellers', true], ['/admin/sellers/', true], ['/admin/sellers', true], ['/admin/dash', false]]
        const ok = steps.length === 4 && want.every(([p, b], i) => steps[i].path?.startsWith(p) && steps[i].back === b) && steps[2].path === '/admin/sellers'
        if (!ok) issue(where('back'), steps)
        else console.log('ok   ', where('back'))
        rec({ where: where('back'), ok, steps })
      } else {
        // QR start of the upload screen: native scanner on Android / iOS, in-app camera elsewhere.
        await nav(page, '/seller/upload')
        const btn = page.getByText('Сканировать QR-код')
        const hasBtn = await btn.count()
        let opened = 'no-button'
        if (hasBtn) {
          await page.evaluate(() => { window.__ev.length = 0 })
          await btn.first().click(); await page.waitForTimeout(1500)
          const ev = await page.evaluate(() => window.__ev.map(([n]) => n))
          opened = ev.includes('web_app_open_scan_qr_popup') ? 'telegram-scanner'
            : (await page.locator('video, [role=dialog]').count()) ? 'in-app-camera' : 'nothing'
          // the person closes the scanner: the real client reports it, the emulator must too
          await page.evaluate(() => window.Telegram?.WebView?.receiveEvent('scan_qr_popup_closed', {}))
          await page.keyboard.press('Escape'); await page.waitForTimeout(300)
        }
        const errs = page._errs.filter((e) => !/favicon|telemetry/.test(e))
        const want = MOBILE.has(platform) ? 'telegram-scanner' : ['in-app-camera', 'no-button']
        const ok = (Array.isArray(want) ? want.includes(opened) : opened === want) && !errs.some((e) => e.startsWith('pageerror'))
        if (!ok) issue(where('qr'), { opened, want, errs })
        else console.log('ok   ', where('qr'), opened)
        rec({ where: where('qr'), ok, opened, errs })
        await nav(page, '/seller/home')
      }
    }
    await page.context().close()
  }
}
await browser.close()
console.log(`DEVICES ${ENGINE} issues=${issues}`)
process.exit(issues ? 1 : 0)
