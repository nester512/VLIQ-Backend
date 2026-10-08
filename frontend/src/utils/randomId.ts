/**
 * Random id that works in old Telegram WebViews too: `crypto.randomUUID` is
 * missing on iOS < 15.4 and Android WebView < 92 (calling it would crash the page).
 */
export function randomId(length = 12): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  let hex: string
  if (c?.randomUUID) {
    hex = c.randomUUID().replace(/-/g, '')
  } else if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16))
    hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  } else {
    hex = (Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2))
  }
  return hex.slice(0, length)
}

/** Short stable hash (FNV-1a, 32 bit, hex) — e.g. to bind an idempotency key to a payload. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
