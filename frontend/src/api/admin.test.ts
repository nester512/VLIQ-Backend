import { describe, it, expect, beforeEach, vi } from 'vitest'

// Contract test for the admin receipt mapper (mapAdminReceipt) — exercised via
// the real getAdminReceipts so the backend→frontend wire mapping is covered.
const get = vi.fn<(...a: unknown[]) => Promise<{ data: unknown }>>()
vi.mock('./client', () => ({
  api: { get: (...a: unknown[]) => get(...a) },
}))

import { getAdminReceipts, type AdminReceipt } from './admin'

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
