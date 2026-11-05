import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectReviewEvents } from './reviewEvents'
import { authStore } from '@/store/authStore'

// A fetch Response whose body yields the given SSE chunks, then ends (server/proxy closed it).
function sseResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  authStore.setState({ token: 'tok' })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => vi.unstubAllGlobals())

describe('review deck SSE client', () => {
  it('sends the JWT in a header (never in the URL) and reports receipt ids', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'retry: 5000\n\n',
        'event: hello\ndata: {"now": "2026-11-05T10:00:00+00:00"}\n\n',
        'event: receipt\ndata: {"receipt_id": 41}\n\nevent: rec', // a frame split across chunks
      ]),
    )
    fetchMock.mockReturnValue(new Promise(() => {}))
    const got: string[] = []
    const stop = connectReviewEvents((id) => got.push(id), { baseUrl: '/api/v1', retryMs: 1 })
    await vi.waitFor(() => expect(got).toEqual(['41']))

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/v1/receipts/review-events')
    expect(String(url)).not.toContain('tok')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    stop()
  })

  it('reconnects after a drop with `since` = the last server time seen (catch-up)', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['event: ping\ndata: {"now": "2026-11-05T10:00:20+00:00"}\n\n']))
    fetchMock.mockReturnValue(new Promise(() => {}))
    const stop = connectReviewEvents(() => {}, { baseUrl: '/api/v1', retryMs: 1 })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/receipts/review-events?since=${encodeURIComponent('2026-11-05T10:00:20+00:00')}`,
    )
    stop()
  })

  it('closes the stream while Telegram is in the background and reopens it on return', async () => {
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    let aborted = false
    fetchMock.mockImplementationOnce((_u, init) => {
      init?.signal?.addEventListener('abort', () => { aborted = true })
      return new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))
    })
    fetchMock.mockReturnValue(new Promise(() => {}))
    const stop = connectReviewEvents(() => {}, { baseUrl: '/api/v1', retryMs: 60_000 })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(aborted).toBe(true))

    hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2)) // not after the 60 s pause
    stop()
  })

  it('stops for good when the server refuses the user (not an admin / logged out)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }))
    const stop = connectReviewEvents(() => {}, { baseUrl: '/api/v1', retryMs: 1 })
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    stop()
  })
})
