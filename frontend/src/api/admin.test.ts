import { describe, it, expect, beforeEach, vi } from 'vitest'

// Contract test for the admin receipt mapper (mapAdminReceipt) — exercised via
// the real getAdminReceipts so the backend→frontend wire mapping is covered.
const get = vi.fn<(...a: unknown[]) => Promise<{ data: unknown }>>()
vi.mock('./client', () => ({
  api: { get: (...a: unknown[]) => get(...a) },
}))

import { getAdminReceipts, getAdminSellerById, getAdminSellers, type AdminReceipt } from './admin'

interface BackendReceiptLike {
  id: number
  seller_id: number
  status: string
  [k: string]: unknown
}

function paged(items: BackendReceiptLike[]) {
  return { data: { items, total: items.length, page: 1, limit: 50 } }
}

async function mapOne(receipt: BackendReceiptLike): Promise<AdminReceipt> {
  get.mockResolvedValueOnce(paged([receipt]))
  const res = await getAdminReceipts({ status: ['on_review'] })
  return res.items[0]!
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mapAdminReceipt — attachments', () => {
  it('maps and stable-sorts attachments by position', async () => {
    const r = await mapOne({
      id: 1,
      seller_id: 9,
      status: 'on_review',
      attachments: [
        { id: 20, position: 2, kind: 'pdf', mime_type: 'application/pdf', url: 'b' },
        { id: 10, position: 0, kind: 'image', mime_type: 'image/jpeg', url: 'a' },
        { id: 15, position: 1, kind: 'image', mime_type: 'image/png', url: null },
      ],
    })
    expect(r.attachments.map((a) => a.position)).toEqual([0, 1, 2])
    expect(r.attachments[0]!.kind).toBe('image')
    expect(r.attachments[1]!.url).toBeNull()
    expect(r.attachments[2]!.kind).toBe('pdf')
  })

  it('falls back to a synthetic image attachment from legacy file_url', async () => {
    const r = await mapOne({
      id: 2,
      seller_id: 9,
      status: 'on_review',
      file_url: 'https://x/legacy.jpg',
    })
    expect(r.attachments).toHaveLength(1)
    expect(r.attachments[0]!.kind).toBe('image')
    expect(r.attachments[0]!.url).toBe('https://x/legacy.jpg')
    // Legacy mirror preserved.
    expect(r.file_url).toBe('https://x/legacy.jpg')
  })

  it('yields an empty attachments array when nothing is available', async () => {
    const r = await mapOne({ id: 3, seller_id: 9, status: 'on_review' })
    expect(r.attachments).toEqual([])
  })
})

describe('mapAdminReceipt — fraud / duplicate signals', () => {
  it('maps multiple_receipts_detected into identities + a human-readable signal', async () => {
    const r = await mapOne({
      id: 4,
      seller_id: 9,
      status: 'rejected',
      rejection_reason: 'В одной загрузке обнаружено несколько разных чеков…',
      fraud_signals: [
        {
          signal: 'multiple_receipts_detected',
          severity: 'danger',
          details: {
            identities: [
              { fn: '111', fd: '1', fp: '1001' },
              { fn: '222', fd: '2', fp: '2002' },
            ],
          },
        },
      ],
    })
    expect(r.detected_identities).toHaveLength(2)
    expect(r.detected_identities![0]!.fn).toBe('111')
    expect(r.fraud_signal![0]!.type).toBe('multiple_receipts_detected')
    expect(r.fraud_signal![0]!.details).toContain('несколько разных чеков')
    expect(r.rejection_reason).toContain('несколько разных чеков')
  })

  it('flags a historical duplicate and carries duplicate_of_id', async () => {
    const r = await mapOne({
      id: 5,
      seller_id: 9,
      status: 'on_review',
      fraud_signals: [
        { signal: 'historical_duplicate_fn_fd_fp', severity: 'danger', duplicate_of_id: 77 },
      ],
    })
    expect(r.duplicate_status).toBe('danger')
    expect(r.fraud_signal![0]!.duplicate_of_id).toBe(77)
    expect(r.fraud_signal![0]!.details).toContain('Дубль')
  })

  it('translates raw QR duplicate signals instead of exposing backend slugs/details', async () => {
    const r = await mapOne({
      id: 55,
      seller_id: 9,
      status: 'on_review',
      fraud_signals: [
        { signal: 'qr_raw_duplicate', severity: 'high', duplicate_of_id: 227 },
      ],
    })

    expect(r.duplicate_status).toBe('danger')
    expect(r.fraud_signal![0]!.details).toBe('Дубль QR-кода — этот чек уже загружался')
    expect(r.fraud_signal![0]!.details).not.toContain('qr_raw_duplicate')
  })

  it('marks a clean receipt as unique', async () => {
    const r = await mapOne({ id: 6, seller_id: 9, status: 'on_review' })
    expect(r.duplicate_status).toBe('ok')
    expect(r.fraud_signal).toBeUndefined()
  })
})

describe('mapAdminReceipt — extraction warnings + identities from ocr_raw', () => {
  it('collects warnings across positions and reads detected_identities', async () => {
    const r = await mapOne({
      id: 7,
      seller_id: 9,
      status: 'on_review',
      ocr_raw: {
        extraction_evidence: {
          '0': { kind: 'image', qr_candidates: 0, warnings: ['file_unreadable'] },
          '1': { kind: 'pdf', pdf_pages: 2, warnings: ['pdf_not_rasterized', 'Низкая чёткость'] },
        },
        detected_identities: [{ fn: '900', fd: '5', fp: '5050' }],
      },
    })
    expect(r.extraction_warnings).toEqual([
      'Файл не удалось прочитать',
      'PDF не удалось преобразовать в изображение',
      'Низкая чёткость',
    ])
    expect(r.detected_identities).toEqual([{ fn: '900', fd: '5', fp: '5050' }])
  })
})

describe('admin sellers API — stats, filters and the detail mapper', () => {
  const stats = {
    receipts_total: 12, receipts_approved: 9, receipts_rejected: 1, receipts_on_review: 2, receipts_30d: 4,
    receipts_duplicates: 0, first_receipt_at: null, last_receipt_at: null, risk_score: 5, risk_level: 'low', risk_flags: [],
  }
  const wireSeller = { telegram_id: 77, brand_id: 1, phone_e164: '+79990000077', status: 'active', created_at: '2026-01-01T00:00:00Z' }

  it('GET /sellers/{id}: keeps balance and receipt count (used to be dropped → «—» in the card)', async () => {
    get.mockResolvedValueOnce({
      data: {
        ...wireSeller, stats, balance_available: 150_000, receipts_total: 12,
        total_accrued: 300_000, total_paid_out: 100_000, on_hold: 50_000, avg_bonus: 12_500,
        weekly_activity: [{ week_start: '2026-10-05', receipts: 3, approved: 2 }],
      },
    })

    const s = await getAdminSellerById(77)

    expect(s.balance).toBe(150_000)
    expect(s.receipts_total).toBe(12)
    expect(s.receipts_approved).toBe(9)
    expect(s.on_hold).toBe(50_000)
    expect(s.avg_bonus).toBe(12_500)
    expect(s.stats?.receipts_30d).toBe(4)
    expect(s.weekly_activity).toHaveLength(1)
  })

  it('GET /sellers: passes sort / risk / has_on_review and maps per-row stats', async () => {
    get.mockResolvedValueOnce({ data: { items: [{ ...wireSeller, stats }], total: 2014, page: 1, limit: 50, has_more: true } })

    const res = await getAdminSellers({ sort: 'receipts_30d:desc', risk: 'high', has_on_review: true, search: 'Анна', page: 1, limit: 50 })

    expect(get).toHaveBeenCalledWith('/sellers', {
      params: { sort: 'receipts_30d:desc', risk: 'high', has_on_review: true, search: 'Анна', page: 1, limit: 50 },
    })
    expect(res.total).toBe(2014)
    expect(res.items[0]!.stats?.risk_level).toBe('low')
    expect(res.items[0]!.receipts_total).toBe(12)
  })

  it('GET /receipts: forwards order=desc for seller history', async () => {
    get.mockResolvedValueOnce(paged([]))
    await getAdminReceipts({ seller_id: 77, order: 'desc' })
    expect(get).toHaveBeenCalledWith('/receipts', { params: { seller_id: 77, order: 'desc', page: 1, limit: 50 } })
  })
})
