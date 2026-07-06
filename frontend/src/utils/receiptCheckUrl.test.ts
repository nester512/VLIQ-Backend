import { describe, it, expect } from 'vitest'
import { receiptCheckUrl } from './receiptCheckUrl'

describe('receiptCheckUrl (KAN-12)', () => {
  it('builds a check.ofd.ru permalink from the fiscal triple', () => {
    expect(
      receiptCheckUrl({ fn: '8712000101234567', fd: '12345', fp: '1234567890' }),
    ).toBe('https://check.ofd.ru/rec/8712000101234567/12345/1234567890')
  })

  it('returns null when any part of the triple is missing', () => {
    expect(receiptCheckUrl({ fn: '871200', fd: '12345', fp: null })).toBeNull()
    expect(receiptCheckUrl({ fn: undefined, fd: '12345', fp: '99' })).toBeNull()
    expect(receiptCheckUrl({ fn: '871200', fd: '', fp: '99' })).toBeNull()
    expect(receiptCheckUrl({})).toBeNull()
  })

  it('URL-encodes unexpected characters instead of breaking the path', () => {
    expect(receiptCheckUrl({ fn: 'a/b', fd: '1', fp: '2' })).toBe(
      'https://check.ofd.ru/rec/a%2Fb/1/2',
    )
  })
})
