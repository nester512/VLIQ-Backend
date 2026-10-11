import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { chromium } from '/app/node_modules/playwright/index.mjs'

export const BASE = process.env.BASE ?? 'https://test-nekuro.online'
export const ID = JSON.parse(readFileSync('/out/initdata.json', 'utf8'))
const THEMES = {
  dark: { bg_color: '#212121', secondary_bg_color: '#181818', section_bg_color: '#212121', text_color: '#ffffff', hint_color: '#aaaaaa', link_color: '#8774e1', button_color: '#8774e1', button_text_color: '#ffffff', accent_text_color: '#8774e1', destructive_text_color: '#e53935', header_bg_color: '#212121', section_separator_color: '#0f0f0f', subtitle_text_color: '#aaaaaa', section_header_text_color: '#8774e1' },
  light: { bg_color: '#ffffff', secondary_bg_color: '#f4f4f5', section_bg_color: '#ffffff', text_color: '#000000', hint_color: '#707579', link_color: '#3390ec', button_color: '#3390ec', button_text_color: '#ffffff', accent_text_color: '#3390ec', destructive_text_color: '#e53935', header_bg_color: '#ffffff', section_separator_color: '#e7e7e7', subtitle_text_color: '#707579', section_header_text_color: '#3390ec' },
}
export const LOG = '/out/findings.jsonl'

let browser
export async function start() { browser = await chromium.launch(); return browser }
export async function stop() { await browser?.close() }

export async function open(account, theme, width = 344) {
  const ctx = await browser.newContext({ viewport: { width, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme, locale: 'ru-RU',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 Telegram-Android/11.5.0' })
  const page = await ctx.newPage()
  page._errs = []
  page._tag = `${account}-${theme}`
  page.on('console', (m) => { if (m.type() === 'error') page._errs.push(`console: ${m.text().slice(0, 300)}`) })
  page.on('pageerror', (e) => page._errs.push(`pageerror: ${String(e).slice(0, 300)}`))
  page.on('response', (r) => { if (r.status() >= 400) page._errs.push(`HTTP ${r.status()} ${r.request().method()} ${r.url().replace(/tgWebAppData=[^&]*/, 'tgWebAppData=…').slice(0, 200)}`) })
  page.on('requestfailed', (r) => { const u = r.url(); if (!/telemetry|analytics/.test(u)) page._errs.push(`FAILED ${r.method()} ${u.slice(0, 160)} ${r.failure()?.errorText}`) })
  const hash = new URLSearchParams({ tgWebAppData: ID[account], tgWebAppVersion: '8.0', tgWebAppPlatform: 'android', tgWebAppThemeParams: JSON.stringify(THEMES[theme]) }).toString()
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  return page
}

export async function nav(page, path) {
  await page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate', { state: {} })) }, path)
  await settle(page)
}
export async function settle(page, ms = 1200) {
  try { await page.waitForLoadState('networkidle', { timeout: 8000 }) } catch {}
  await page.waitForTimeout(ms)
}

export async function detect(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const vis = (el) => { const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const desc = (el) => { const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60); const c = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 3).join('.'); return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${el.dataset.testid ? '[' + el.dataset.testid + ']' : ''} «${t}»` }
    const all = [...document.body.querySelectorAll('*')].filter((el) => !(el instanceof SVGElement) || el.tagName === 'svg')
    const res = { overflowX: document.documentElement.scrollWidth > vw + 1 ? document.documentElement.scrollWidth : 0, clipped: [], beyond: [], overlaps: [], garbage: [] }
    const scrollerX = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p !== document.body && p !== document.documentElement) return p } return null }
    for (const el of all) {
      if (!vis(el) || el.closest('.sr-only')) continue
      const s = getComputedStyle(el)
      if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) res.clipped.push('ellipsis ' + desc(el) + ` (${el.scrollWidth}>${el.clientWidth})`)
      const lc = s.webkitLineClamp || s.getPropertyValue('-webkit-line-clamp')
      if (lc && lc !== 'none' && el.scrollHeight > el.clientHeight + 2) res.clipped.push(`clamp${lc} ` + desc(el) + ` (${el.scrollHeight}>${el.clientHeight})`)
      // single-line overflow-hidden text cut without ellipsis
      if (s.overflow === 'hidden' && s.whiteSpace === 'nowrap' && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.children.length === 0) res.clipped.push('hardcut ' + desc(el))
      const r = el.getBoundingClientRect()
      const card = el.parentElement?.closest('.vliq-card, [class*="card"], [role="dialog"]')
      if (card && (el.tagName === 'INPUT' || el.tagName === 'BUTTON' || el.children.length === 0)) {
        const cr = card.getBoundingClientRect()
        if (r.right > cr.right + 1 || r.left < cr.left - 1) { const sc = scrollerX(el); if (!sc || !card.contains(sc) || sc === card) res.beyond.push('outOfCard ' + desc(el) + ` [${Math.round(r.left)}..${Math.round(r.right)} vs card ${Math.round(cr.left)}..${Math.round(cr.right)}]`) }
      }
      if ((r.right > vw + 1 || r.left < -1) && r.width < vw * 3) {
        const sc = scrollerX(el)
        const fixedAnc = el.closest('[style*="transform"]')
        if (!sc && !fixedAnc) res.beyond.push(desc(el) + ` [${Math.round(r.left)}..${Math.round(r.right)}]`)
      }
    }
    // overlap among leaf text / buttons / pills
    const leaves = all.filter((el) => vis(el) && ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || el.tagName === 'BUTTON' || el.tagName === 'INPUT' || el.tagName === 'svg'))
      .filter((el) => !el.closest('[aria-hidden="true"]') && getComputedStyle(el).position !== 'absolute')
    const rects = leaves.map((el) => ({ el, r: el.getBoundingClientRect() }))
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (w > 2 && h > 2) {
        // ignore fixed chrome vs scrolled content
        const fa = !!a.el.closest('header, nav, [role="dialog"]'), fb = !!b.el.closest('header, nav, [role="dialog"]')
        if (fa !== fb) continue
        res.overlaps.push(`${desc(a.el)} ⨯ ${desc(b.el)} (${Math.round(w)}x${Math.round(h)})`)
      }
    }
    const txt = document.body.innerText
    const re = /\b[a-z]+_[a-z_]+\b|\bundefined\b|\bnull\b|\bNaN\b|\[object|Invalid Date/g
    res.garbage = [...new Set(txt.match(re) || [])]
    res.overlaps = res.overlaps.slice(0, 15); res.clipped = [...new Set(res.clipped)].slice(0, 20); res.beyond = res.beyond.slice(0, 10)
    return res
  })
}

export async function shot(page, name, { tall = true } = {}) {
  const vp = page.viewportSize()
  const det = await detect(page)
  const errs = page._errs.splice(0)
  await page.screenshot({ path: `/out/shots/${name}-${vp.width}.png` })
  if (tall) {
    const h = await page.evaluate(() => { let m = document.documentElement.scrollHeight; for (const el of document.querySelectorAll('*')) { const s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 10) m = Math.max(m, el.scrollHeight + 140) } return m })
    if (h > vp.height + 20) {
      await page.setViewportSize({ width: vp.width, height: Math.min(h, 5000) })
      await page.waitForTimeout(400)
      await page.screenshot({ path: `/out/shots/${name}-${vp.width}-full.png` })
      await page.setViewportSize(vp)
      await page.waitForTimeout(300)
    }
  }
  const rec = { name: `${name}-${vp.width}`, ...det, errs }
  appendFileSync(LOG, JSON.stringify(rec) + '\n')
  const flag = det.overflowX || det.clipped.length || det.beyond.length || det.overlaps.length || det.garbage.length || errs.length
  console.log(flag ? 'FLAG' : 'ok  ', rec.name, flag ? JSON.stringify({ ...det, errs }) : '')
  return det
}

export async function both(page, name, fn) {
  for (const w of [344, 412]) {
    await page.setViewportSize({ width: w, height: w === 344 ? 780 : 915 })
    await page.waitForTimeout(400)
    if (fn) await fn(w)
    await shot(page, name)
  }
}
