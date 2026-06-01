/**
 * Safe accessor for window.Telegram.WebApp.
 * Returns undefined if running outside Telegram context.
 */
export function getTgWebApp(): Telegram['WebApp'] | undefined {
  return typeof window !== 'undefined'
    ? (window as Window & { Telegram?: Telegram }).Telegram?.WebApp
    : undefined
}

/**
 * Returns true when running inside Telegram Mini App.
 *
 * `telegram-web-app.js` always injects `window.Telegram.WebApp` (even in browsers),
 * but only inside Telegram it gets a non-empty `initData` string with HMAC signature.
 * That's our real signal — empty initData means we're in a regular browser.
 */
export function isTmaEnvironment(): boolean {
  const wa = getTgWebApp()
  return Boolean(wa?.initData && wa.initData.length > 0)
}

/**
 * Detects Telegram WebView even before initData has settled.
 *
 * Telegram-Android delivers initData asynchronously after the WebView paints —
 * `isTmaEnvironment()` can return `false` for ~200-1500ms inside a real
 * Telegram Mini App launch, which used to trigger the "outside Telegram"
 * error screen on Android. This helper tells us we're _inside_ Telegram
 * (so we should wait + retry) without committing to having a signed initData.
 */
export function isLikelyTmaContext(): boolean {
  if (typeof window === 'undefined') return false
  const win = window as Window & { Telegram?: { WebApp?: unknown } }
  // Any of these is a strong "we're inside Telegram WebView" hint:
  //   - window.Telegram.WebApp exists (script loaded)
  //   - URL contains the standard initData fragment Telegram appends
  //   - User-Agent identifies a Telegram client
  if (win.Telegram?.WebApp) return true
  if (typeof window.location !== 'undefined') {
    const hash = window.location.hash || ''
    if (hash.includes('tgWebAppData') || hash.includes('tgWebAppPlatform')) return true
  }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  if (/Telegram-(Android|iOS|Mac|Linux)/i.test(ua) || /TelegramWebview/i.test(ua)) return true
  return false
}

/**
 * Awaits Telegram's `initData` for up to `maxMs`. Resolves with the initData
 * string once available, or `null` after the timeout.
 *
 * Used to bridge the Android delay window described in `isLikelyTmaContext`.
 */
export async function waitForInitData(maxMs = 2500): Promise<string | null> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const wa = getTgWebApp()
    if (wa?.initData && wa.initData.length > 0) return wa.initData
    await new Promise((r) => setTimeout(r, 80))
  }
  const wa = getTgWebApp()
  return wa?.initData && wa.initData.length > 0 ? wa.initData : null
}

// Minimal type stubs for Telegram global (real types come from @types/telegram-web-app if added)
interface Telegram {
  WebApp: {
    initData: string
    initDataUnsafe: {
      user?: {
        id: number
        first_name?: string
        last_name?: string
        username?: string
        photo_url?: string
        phone_number?: string
      }
    }
    colorScheme: 'light' | 'dark'
    themeParams?: Record<string, string>
    onEvent?: (event: string, handler: () => void) => void
    offEvent?: (event: string, handler: () => void) => void
    close: () => void
    ready: () => void
    expand?: () => void
    requestContact?: (
      callback: (
        shared: boolean,
        payload: { responseUnsafe: { contact: { phone_number?: string } } },
      ) => void,
    ) => void
  }
}
