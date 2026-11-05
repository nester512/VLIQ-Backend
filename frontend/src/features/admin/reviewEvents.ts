import { authStore } from '@/store/authStore'

/**
 * «Новые чеки на проверке» — the admin review deck's live hint (UC-A2, SSE).
 *
 * `EventSource` cannot send the Authorization header and the JWT must not go into a URL
 * (it would land in proxy logs), so the stream is read with fetch. Telegram / the phone
 * drop connections of a backgrounded Mini App: the stream is closed while the app is
 * hidden and reopened when it is shown again, with `since` = the last server time seen,
 * so the server replays what reached the queue meanwhile. Events are hints only — the
 * deck loads the receipts through the regular list endpoint.
 */

const PATH = '/receipts/review-events'
const RETRY_MS = 5_000

export interface ReviewEventsOptions {
  baseUrl?: string
  retryMs?: number
}

interface Frame {
  event: string
  data: string
}

function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop() ?? ''
  const frames: Frame[] = []
  for (const part of parts) {
    let event = 'message'
    const data: string[] = []
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trim())
    }
    if (data.length) frames.push({ event, data: data.join('\n') })
  }
  return { frames, rest }
}

/** Connects and keeps reconnecting until the returned stop() is called. */
export function connectReviewEvents(onReceipt: (id: string) => void, opts: ReviewEventsOptions = {}): () => void {
  const baseUrl = opts.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
  const retryMs = opts.retryMs ?? RETRY_MS
  let stopped = false
  let since: string | null = null
  let current: AbortController | null = null
  let wake: (() => void) | null = null
  let kicked = false // «reconnect now» that arrived before the loop started waiting

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      if (kicked) {
        kicked = false
        resolve()
        return
      }
      const t = setTimeout(done, ms)
      function done() {
        clearTimeout(t)
        wake = null
        resolve()
      }
      wake = done
    })

  const onVisibility = () => {
    if (document.hidden) current?.abort() // the OS would cut it anyway; reopen on return
    else if (wake) wake() // back in the app: reconnect now, not after the retry pause
    else kicked = true
  }
  document.addEventListener('visibilitychange', onVisibility)

  async function readOnce(): Promise<'retry' | 'stop'> {
    const token = authStore.getState().token
    if (!token) return 'stop'
    kicked = false
    current = new AbortController()
    const url = `${baseUrl}${PATH}${since ? `?since=${encodeURIComponent(since)}` : ''}`
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: current.signal,
      cache: 'no-store',
    })
    if (resp.status === 401 || resp.status === 403) return 'stop'
    if (!resp.ok || !resp.body) return 'retry'
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return 'retry'
      buffer += decoder.decode(value, { stream: true })
      const { frames, rest } = parseFrames(buffer)
      buffer = rest
      for (const f of frames) {
        try {
          const data = JSON.parse(f.data) as { now?: string; receipt_id?: number }
          if (data.now) since = data.now
          if (f.event === 'receipt' && data.receipt_id != null) onReceipt(String(data.receipt_id))
        } catch {
          /* a malformed frame is skipped, the stream goes on */
        }
      }
    }
  }

  void (async () => {
    while (!stopped) {
      if (document.hidden) {
        await pause(60_000) // woken by visibilitychange
        continue
      }
      let outcome: 'retry' | 'stop'
      try {
        outcome = await readOnce()
      } catch {
        outcome = 'retry' // network drop / abort on hide
      }
      if (outcome === 'stop' || stopped) break
      await pause(document.hidden ? 60_000 : retryMs)
    }
  })()

  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisibility)
    current?.abort()
    wake?.()
  }
}
