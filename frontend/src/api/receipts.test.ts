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

import { uploadReceipt } from './receipts'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('uploadReceipt — multipart contract', () => {
  it('posts FormData with file + brand_id and clears the JSON Content-Type', async () => {
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'r.jpg', {
      type: 'image/jpeg',
    })

    const result = await uploadReceipt(file, 3)

    expect(post).toHaveBeenCalledTimes(1)
    const [url, body, config] = post.mock.calls[0] as unknown as [
      string,
      FormData,
      { headers: Record<string, unknown> },
    ]
    expect(url).toBe('/receipts/upload')
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('brand_id')).toBe('3')
    expect(body.get('file')).toBeInstanceOf(File)
    // Critical: Content-Type must be nulled so the browser adds the multipart
    // boundary. If it stays application/json, axios serializes FormData→JSON
    // and the server 422s.
    expect(config.headers['Content-Type']).toBeNull()

    expect(result).toEqual({ id: '7' })
  })
})
