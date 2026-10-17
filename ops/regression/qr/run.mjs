// QR regression: every file of a dataset through the seller app's own QR code (decode + pick the
// fiscal receipt), compared with the dataset's expectations (regression.csv).
//
// Verdicts (dataset REGRESSION.md): PASS; FAIL — wrong receipt / non-fiscal accepted / fiscal rejected;
// LABEL_FIX — a «reject» file was read and matches expected_qr (the app reads better than the label);
// REVIEW — a «reject» file was read but expected_qr is empty (look at it).
// tier «smoke» is blocking, «hard» is not. Output: counts only + results.csv (path, verdict, reason) —
// no receipt contents in the console. Exit 1 on any smoke FAIL.
//
// Env: DATASET (dir with regression.csv and the files), BASE (vite dev server), OUT (results dir),
//      LIMIT (optional, first N rows), ONLY (optional regexp on path).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { chromium } from '/app/node_modules/playwright/index.mjs'

const DATASET = process.env.DATASET
const BASE = process.env.BASE ?? 'http://127.0.0.1:5179'
const OUT = process.env.OUT ?? '/out'
const LIMIT = Number(process.env.LIMIT ?? 0)
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const [head, ...body] = rows
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

// Normalised as the dataset says: i, fp without leading zeros; s with 2 decimals; t = YYYYMMDDTHHMM.
const nz = (v) => String(v ?? '').replace(/^0+(?=\d)/, '')
const norm = (r) => r && ({
  fn: String(r.fn ?? '').trim(), i: nz(r.i), fp: nz(r.fp),
  s: r.s === '' || r.s == null ? '' : Number(String(r.s).replace(',', '.')).toFixed(2),
  t: String(r.t ?? '').slice(0, 13),
})
const fromQr = (qr) => {
  if (!qr) return null
  const p = new URLSearchParams(qr.includes('?') && /^https?:/i.test(qr) ? qr.slice(qr.indexOf('?') + 1) : qr)
  return p.get('fn') ? norm({ fn: p.get('fn'), i: p.get('i'), fp: p.get('fp'), s: p.get('s'), t: p.get('t') }) : null
}
const same = (a, b) => a && b && a.fn === b.fn && a.i === b.i && a.fp === b.fp && (!b.s || a.s === b.s) && (!b.t || a.t === b.t)

function verdict(row, res) {
  const want = row.fn ? norm(row) : fromQr(row.golden_qr || row.expected_qr)
  const got = res.receipts.map(norm)
  if (row.expect === 'accept') {
    if (res.kind === 'one') {
      if (!want) return ['PASS', 'accepted (no reference fields)']
      return same(got[0], want) ? ['PASS', 'accepted, fields match'] : ['FAIL', 'accepted a different receipt']
    }
    if (res.kind === 'many') return want && got.some((g) => same(g, want)) ? ['PASS', 'several receipts, the right one offered'] : ['FAIL', 'several receipts, the right one missing']
    return ['FAIL', res.kind === 'error' ? `fiscal QR rejected (${res.problem})` : 'fiscal QR not read']
  }
  // expect === 'reject'
  if (res.kind === 'none' || res.kind === 'error') return ['PASS', 'rejected']
  const expected = fromQr(row.expected_qr)
  if (expected && got.some((g) => same(g, expected))) return ['LABEL_FIX', 'read a receipt that matches expected_qr']
  if (!row.expected_qr) return ['REVIEW', 'read a fiscal receipt, expected_qr empty']
  return ['FAIL', 'accepted a receipt on a reject file']
}

let rows = parseCsv(readFileSync(join(DATASET, 'regression.csv'), 'utf8'))
if (ONLY) rows = rows.filter((r) => ONLY.test(r.path))
if (LIMIT) rows = rows.slice(0, LIMIT)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage()
const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.heic': 'image/heic' }
await page.route('**/__ds/**', (route) => {
  const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/__ds\//, ''))
  const file = join(DATASET, rel)
  if (!existsSync(file)) return route.fulfill({ status: 404, body: '' })
  return route.fulfill({ status: 200, body: readFileSync(file), contentType: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' })
})
await page.goto(`${BASE}/qr-regression.html`)
await page.waitForFunction(() => window.__qrReady === true, null, { timeout: 120000 })

const results = []
const tally = {}
const t0 = Date.now()
for (const [n, row] of rows.entries()) {
  let res
  if (!existsSync(join(DATASET, row.path))) res = { kind: 'error', receipts: [], problem: 'file_missing', ms: 0 }
  else {
    try {
      res = await page.evaluate(([url, name]) => window.__qrCheck(url, name), [`/__ds/${encodeURIComponent(row.path).replace(/%2F/g, '/')}`, row.path])
    } catch (e) {
      res = { kind: 'error', receipts: [], problem: 'harness:' + String(e).slice(0, 60), ms: 0 }
      await page.goto(`${BASE}/qr-regression.html`); await page.waitForFunction(() => window.__qrReady === true)
    }
  }
  const [v, why] = verdict(row, res)
  const key = `${row.expect}|${row.case}|${row.tier}`
  tally[key] ??= { PASS: 0, FAIL: 0, LABEL_FIX: 0, REVIEW: 0, ms: 0, n: 0 }
  tally[key][v]++; tally[key].ms += res.ms; tally[key].n++
  results.push({ path: row.path, expect: row.expect, case: row.case, tier: row.tier, verdict: v, reason: why, ms: res.ms })
  if ((n + 1) % 100 === 0) console.log(`progress ${n + 1}/${rows.length} · ${Math.round((Date.now() - t0) / 1000)} s`)
}
await browser.close()

const csv = ['path,expect,case,tier,verdict,reason,ms', ...results.map((r) => [r.path, r.expect, r.case, r.tier, r.verdict, r.reason, r.ms].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','))].join('\n')
writeFileSync(join(OUT, 'results.csv'), csv)

console.log('\nexpect | case | tier | files | PASS | FAIL | LABEL_FIX | REVIEW | avg ms')
let smokeFail = 0
for (const [k, t] of Object.entries(tally).sort()) {
  console.log(`${k.replaceAll('|', ' | ')} | ${t.n} | ${t.PASS} | ${t.FAIL} | ${t.LABEL_FIX} | ${t.REVIEW} | ${Math.round(t.ms / t.n)}`)
  if (k.endsWith('|smoke')) smokeFail += t.FAIL
}
const reasons = {}
for (const r of results.filter((x) => x.verdict !== 'PASS')) reasons[`${r.verdict}: ${r.reason}`] = (reasons[`${r.verdict}: ${r.reason}`] ?? 0) + 1
console.log('\nnot PASS by reason:', JSON.stringify(reasons, null, 1))
console.log(`\nQR_REGRESSION files=${results.length} smoke_fail=${smokeFail} total ${Math.round((Date.now() - t0) / 1000)} s · results: ${join(OUT, 'results.csv')}`)
process.exit(smokeFail ? 1 : 0)
