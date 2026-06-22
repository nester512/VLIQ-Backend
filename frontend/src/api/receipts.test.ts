import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the axios instance so we can inspect the outgoing request shape. This is
// deliberately a CONTRACT test of api/receipts.ts itself — the hook/page tests
// mock '@/api/receipts' wholesale, so they never exercise the real request
// construction and could not catch a wrong Content-Type / body-encoding bug.
const post = vi.fn<(...a: unknown[]) => Promise<{ data: { receipt_id: number } }>>(() =>
  Promise.resolve({ data: { receipt_id: 7 } }),
)
vi.mock('./client', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
}))

import { uploadReceiptPackage } from './receipts'

beforeEach(() => {
  vi.clearAllMocks()
})

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type })
}

describe('uploadReceiptPackage — batch multipart contract', () => {
  it('posts ONE FormData with the files field repeated + brand_id + idempotency_key', async () => {
    const files = [
      makeFile('a.jpg', 'image/jpeg'),
      makeFile('b.pdf', 'application/pdf'),
      makeFile('c.png', 'image/png'),
    ]

    const result = await uploadReceiptPackage(files, {
      brandId: 3,
      idempotencyKey: 'idem-123',
    })

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, config] = post.mock.calls[0] as unknown as [
      string,
      FormData,
      { headers: Record<string, unknown> },
    ]
    expect(url).toBe('/receipts/upload')
    expect(body).toBeInstanceOf(FormData)

    // All three files travel under the repeated `files` field.
    const sentFiles = body.getAll('files')
    expect(sentFiles).toHaveLength(3)
    for (const f of sentFiles) expect(f).toBeInstanceOf(File)

    expect(body.get('brand_id')).toBe('3')
    expect(body.get('idempotency_key')).toBe('idem-123')
    // No QR was scanned → the field must be absent.
    expect(body.get('scanned_qr')).toBeNull()

    // Critical: Content-Type must be nulled so the browser adds the multipart
    // boundary. If it stays application/json, axios serializes FormData→JSON.
    expect(config.headers['Content-Type']).toBeNull()

    // receipt_id is mapped to a string id.
    expect(result).toEqual({ id: '7' })
  })

  it('includes scanned_qr only when provided', async () => {
    await uploadReceiptPackage([makeFile('a.jpg', 'image/jpeg')], {
      brandId: 1,
      scannedQr: 't=20240101&s=100',
      idempotencyKey: 'idem-9',
    })

    const [, body] = post.mock.calls[0] as unknown as [string, FormData]
    expect(body.get('scanned_qr')).toBe('t=20240101&s=100')
    expect(body.getAll('files')).toHaveLength(1)
  })
})
