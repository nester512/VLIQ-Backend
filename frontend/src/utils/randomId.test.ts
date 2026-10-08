import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomId, shortHash } from './randomId'

afterEach(() => vi.unstubAllGlobals())

describe('randomId', () => {
  it('works without crypto.randomUUID (old Telegram WebViews)', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array) => a.fill(171) })
    expect(randomId(12)).toBe('abababababab')
  })

  it('works without any crypto at all', () => {
    vi.stubGlobal('crypto', undefined)
    const id = randomId(12)
    expect(id).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('shortHash', () => {
  it('is stable and sensitive to every character', () => {
    expect(shortHash('t=1&s=1.00')).toBe(shortHash('t=1&s=1.00'))
    expect(shortHash('t=1&s=1.00')).not.toBe(shortHash('t=1&s=1.01'))
    expect(shortHash('x')).toMatch(/^[0-9a-f]{8}$/)
  })
})
