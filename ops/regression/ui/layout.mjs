// R-L-*: every screen of both roles at 344 / 412 px, dark and light — no cut text, no overlaps, nothing
// past the edge, no raw codes («on_review», undefined, NaN) and no JS / HTTP errors. Exit 1 on any finding.
import { start, stop, open, nav, detect, settle, ID } from '/out/lib.mjs'

const S = ID.seller_id
const ADMIN = [['dash', '/admin/dash'], ['review', '/admin/review'], ['receipts', '/admin/receipts?sort=sum'], ['payouts', '/admin/payouts'],
  ['sellers', '/admin/sellers'], ['seller', `/admin/sellers/${S}/receipts?sort=bonus`]]
const SELLER = [['home', '/seller/home'], ['upload', '/seller/upload'], ['history', '/seller/history'], ['balance', '/seller/balance'],
  ['payout', '/seller/payout'], ['payouts', '/seller/payouts'], ['promo', '/seller/promo'], ['profile', '/seller/profile']]

const errsOf = (page) => page._errs.filter((e) => !/favicon|telemetry/.test(e))
let issues = 0
function report(where, r, errs, { overlaps = true } = {}) {
  const found = { overflowX: r.overflowX, clipped: r.clipped, beyond: r.beyond, overlaps: overlaps ? r.overlaps : [], garbage: r.garbage, errs }
  if (found.overflowX || found.clipped.length || found.beyond.length || found.overlaps.length || found.garbage.length || errs.length) {
    issues++
    console.log('ISSUE', where, JSON.stringify(found).slice(0, 900))
  } else console.log('ok   ', where)
}

await start()
for (const [acc, pages] of [['admin', ADMIN], ['seller', SELLER]]) for (const w of [344, 412]) for (const theme of ['dark', 'light']) {
  const page = await open(acc, theme, w)
  for (const [name, path] of pages) {
    page._errs.length = 0
    await nav(page, path)
    // the review deck stacks cards on purpose — overlaps there are by design
    report(`${acc} ${w} ${theme} ${name}`, await detect(page), errsOf(page), { overlaps: name !== 'review' })
    if (theme === 'dark' && w === 344) await page.screenshot({ path: `/out/shots/${acc}-${name}.png`, fullPage: true })
  }
  if (acc === 'admin') for (const path of ['/admin/receipts', '/admin/payouts']) {
    page._errs.length = 0
    await nav(page, path); await page.locator('.vliq-row').first().click(); await settle(page)
    report(`admin ${w} ${theme} sheet ${path}`, await detect(page), errsOf(page), { overlaps: false })
    await page.keyboard.press('Escape')
  }
  await page.context().close()
}
await stop()
console.log(`LAYOUT issues=${issues}`)
process.exit(issues ? 1 : 0)
