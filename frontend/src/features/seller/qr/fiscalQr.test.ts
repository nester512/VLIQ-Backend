import { describe, expect, it } from 'vitest'
import { canonicalQr, isTooOld, parseQr, purchaseDateMsk, tFromInputs, validateFields } from './fiscalQr'

// SAME case table as backend/tests/receipt_intake/test_fiscal.py — keep identical.
const NOW = new Date(Date.UTC(2026, 9, 8, 12, 0)) // 15:00 MSK
const FN = '9960440300712345'

const VALID_QR: Array<[string, [string, number, string, string]]> = [
  [`t=20261008T1432&s=1450.00&fn=${FN}&i=12345&fp=3826178549&n=1`, ['20261008T1432', 145000, '12345', '3826178549']],
  [`t=20261008T143205&s=99.9&fn=${FN}&i=7&fp=1&n=1`, ['20261008T143205', 9990, '7', '1']],
  [`t=20261001T0900&s=100&fn=${FN}&i=1&fp=2`, ['20261001T0900', 10000, '1', '2']],
  [`https://check.ofd.ru/rec?t=20261008T1000&s=5.00&fn=${FN}&i=3&fp=4&n=1`, ['20261008T1000', 500, '3', '4']],
  [`fn=${FN}&fp=4&i=3&n=1&s=12,50&t=20261008T1000`, ['20261008T1000', 1250, '3', '4']],
  [`t=20261008T1000&s=1&fn=${FN}&i=00012&fp=0003826178549`, ['20261008T1000', 100, '12', '3826178549']], // padded
]

const INVALID_QR: Array<[string, string]> = [
  ['https://vliq.ru/promo', 'QR_NOT_FISCAL'],
  ['hello', 'QR_NOT_FISCAL'],
  ['t=20261008T1432&s=1450.00&fn=123&i=1&fp=1&n=1', 'QR_FN_INVALID'],
  [`t=20261008T1432&s=1450.00&fn=${FN}&i=0&fp=1&n=1`, 'QR_FD_INVALID'],
  [`t=20261008T1432&s=1450.00&fn=${FN}&i=12345678901&fp=1&n=1`, 'QR_FD_INVALID'],
  [`t=20261008T1432&s=1450.00&fn=${FN}&i=1&fp=abc&n=1`, 'QR_FP_INVALID'],
  [`t=2026-10-08&s=1450.00&fn=${FN}&i=1&fp=1&n=1`, 'QR_DATE_INVALID'],
  [`t=20261332T1432&s=1450.00&fn=${FN}&i=1&fp=1&n=1`, 'QR_DATE_INVALID'],
  [`t=20261012T1432&s=1450.00&fn=${FN}&i=1&fp=1&n=1`, 'QR_DATE_IN_FUTURE'],
  [`t=20261008T1432&s=0.00&fn=${FN}&i=1&fp=1&n=1`, 'QR_SUM_INVALID'],
  [`t=20261008T1432&s=12.345&fn=${FN}&i=1&fp=1&n=1`, 'QR_SUM_INVALID'],
  [`t=20261008T1432&s=1450.00&fn=${FN}&i=1&fp=1&n=2`, 'QR_NOT_INCOME'],
  [`t=20261008T1432&s=1450.00&fn=${FN}&i=1&fp=1&n=x`, 'QR_OPERATION_INVALID'],
  ['t=20261008T1432&s=1&fn=\u0669\u0669\u0666\u0660\u0664\u0664\u0660\u0663\u0660\u0660\u0667\u0661\u0662\u0663\u0664\u0665&i=1&fp=1', 'QR_FN_INVALID'], // Arabic-Indic digits
]

describe('fiscal QR — same table as the server', () => {
  it.each(VALID_QR)('accepts %s', (raw, [t, kop, fd, fp]) => {
    const r = parseQr(raw, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect([r.data.t, r.data.totalKop, r.data.fd, r.data.fp]).toEqual([t, kop, fd, fp])
    expect(r.data.fn).toBe(FN)
  })

  it.each(INVALID_QR)('rejects %s with %s', (raw, code) => {
    const r = parseQr(raw, NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe(code)
    expect(r.error.message).toBeTruthy()
  })
})

describe('fiscal QR — details', () => {
  it('builds the canonical string the server stores', () => {
    const r = parseQr(`fn=${FN}&fp=4&i=3&n=1&s=12,5&t=20261008T1000`, NOW)
    if (!r.ok) throw new Error('expected ok')
    expect(canonicalQr(r.data)).toBe(`t=20261008T1000&s=12.50&fn=${FN}&i=3&fp=4&n=1`)
  })

  it('reads QR time as Moscow time', () => {
    const r = parseQr(`t=20261008T1432&s=1&fn=${FN}&i=1&fp=1`, NOW)
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.purchaseAt.toISOString()).toBe('2026-10-08T11:32:00.000Z')
  })

  it('accepts a shop east of Moscow (up to 14 h ahead)', () => {
    expect(validateFields({ fn: FN, fd: '1', fp: '1', t: '20261008T2359', s: '1' }, NOW).ok).toBe(true)
  })

  it('tolerates spaces in manually typed numbers', () => {
    const r = validateFields({ fn: '9960 4403 0071 2345', fd: ' 12 ', fp: '38261 78549', t: '20261008T1432', s: '1450' }, NOW)
    if (!r.ok) throw new Error('expected ok')
    expect([r.data.fn, r.data.fd, r.data.fp]).toEqual([FN, '12', '3826178549'])
  })

  it('purchase date is the Moscow calendar day', () => {
    const r = validateFields({ fn: FN, fd: '1', fp: '1', t: '20261008T0130', s: '1' }, NOW)
    if (!r.ok) throw new Error('expected ok')
    expect(r.data.purchaseAt.toISOString().slice(0, 10)).toBe('2026-10-07')
    expect(purchaseDateMsk(r.data)).toBe('2026-10-08')
  })

  it('flags (but accepts) receipts older than 30 days', () => {
    const r = validateFields({ fn: FN, fd: '1', fp: '1', t: '20260801T1000', s: '1' }, NOW)
    if (!r.ok) throw new Error('expected ok')
    expect(isTooOld(r.data, NOW)).toBe(true)
  })

  it('builds t from manual date/time inputs', () => {
    expect(tFromInputs('2026-10-08', '14:32')).toBe('20261008T1432')
  })
})
