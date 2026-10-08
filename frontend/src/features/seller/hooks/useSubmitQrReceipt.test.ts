import { describe, expect, it } from 'vitest'
import { validateFields } from '../qr/fiscalQr'
import { idempotencyKey } from './useSubmitQrReceipt'

const NOW = new Date(Date.UTC(2026, 9, 8, 12, 0))
const data = (s: string) => {
  const r = validateFields({ fn: '9960440300712345', fd: '1234567890', fp: '3826178549', t: '20261008T1432', s }, NOW)
  if (!r.ok) throw new Error('bad fixture')
  return r.data
}

describe('idempotencyKey', () => {
  it('a corrected sum is a NEW request, the same data is the same request', () => {
    expect(idempotencyKey('n1', data('1450'))).toBe(idempotencyKey('n1', data('1450.00')))
    expect(idempotencyKey('n1', data('1450'))).not.toBe(idempotencyKey('n1', data('1500')))
  })

  it('fits the 64-char server limit at maximum field lengths', () => {
    expect(idempotencyKey('abcdefabcdef', data('999999999.99')).length).toBeLessThanOrEqual(64)
  })
})
