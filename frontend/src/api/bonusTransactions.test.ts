import { describe, it, expect, beforeEach, vi } from 'vitest'

// Contract test of the bonus-transaction mapping. The balance-page test mocks
// '@/api/bonusTransactions' wholesale, so it never exercises the real mapping —
// and could not catch the "English correction reason leaks to the seller" bug.
const get = vi.fn<(...a: unknown[]) => Promise<{ data: unknown }>>()
vi.mock('./client', () => ({
  api: { get: (...a: unknown[]) => get(...a) },
}))

import { listMyBonusTransactions } from './bonusTransactions'

function paged(items: unknown[]) {
  return { data: { items, total: items.length, page: 1, limit: 50, has_more: false } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listMyBonusTransactions — mapping', () => {
  it('hides the internal English correction reason behind a localized label', async () => {
    get.mockResolvedValueOnce(
      paged([
        {
          id: 1,
          seller_id: 9,
          brand_id: 1,
          amount: 2000,
          kind: 'correction',
          source_type: 'receipt',
          source_id: 277,
          reason: 'Bonus correction on receipt #277 by admin 997459169: 0 → 2000',
          created_at: '2026-06-17T00:00:00Z',
        },
      ]),
    )

    const tx = (await listMyBonusTransactions())[0]!

    expect(tx.description).toBe('Корректировка')
    expect(tx.description).not.toContain('Bonus correction')
    expect(tx.type).toBe('adjustment')
    // amount stays in KOPECKS — the view layer (fmtMoneyDelta) divides by 100.
    expect(tx.amount).toBe(2000)
  })

  it('keeps a curated Russian reason for manual accruals', async () => {
    get.mockResolvedValueOnce(
      paged([
        {
          id: 2,
          seller_id: 9,
          brand_id: 1,
          amount: 10000,
          kind: 'accrual_manual',
          source_type: 'admin',
          source_id: null,
          reason: 'Ручное начисление администратором (+100 ₽)',
          created_at: '2026-06-17T00:00:00Z',
        },
      ]),
    )

    const tx = (await listMyBonusTransactions())[0]!

    expect(tx.description).toBe('Ручное начисление администратором (+100 ₽)')
    expect(tx.type).toBe('bonus')
  })

  it('falls back to a Russian default when reason is null', async () => {
    get.mockResolvedValueOnce(
      paged([
        {
          id: 3,
          seller_id: 9,
          brand_id: 1,
          amount: 450,
          kind: 'accrual_receipt',
          source_type: 'receipt',
          source_id: 5,
          reason: null,
          created_at: '2026-06-17T00:00:00Z',
        },
      ]),
    )

    const tx = (await listMyBonusTransactions())[0]!

    expect(tx.description).toBe('Бонус за чек')
    expect(tx.receipt_id).toBe('5')
  })

  it('hides internal receipt-accrual audit reasons from sellers', async () => {
    get.mockResolvedValueOnce(
      paged([
        {
          id: 4,
          seller_id: 9,
          brand_id: 1,
          amount: 900,
          kind: 'accrual_receipt',
          source_type: 'receipt',
          source_id: 359,
          reason: 'Receipt #359 approved by admin 809296638',
          created_at: '2026-06-17T00:00:00Z',
        },
      ]),
    )

    const tx = (await listMyBonusTransactions())[0]!

    expect(tx.description).toBe('Бонус за чек')
    expect(tx.description).not.toContain('admin')
    expect(tx.description).not.toContain('809296638')
  })
})
