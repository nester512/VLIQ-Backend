/**
 * QR sources on the device. The decoded string is validated by the caller
 * (`parseQr`) — a scanner only reports what it saw.
 */

interface TgScanApi {
  showScanQrPopup?: (p: { text?: string }, cb?: (data: string) => boolean | void) => void
  closeScanQrPopup?: () => void
  isVersionAtLeast?: (version: string) => boolean
  platform?: string
}

// The SDK defines showScanQrPopup everywhere, but only mobile clients ≥ 6.4 can
// scan; Desktop/Web throw WebAppMethodUnsupported or silently open nothing.
const SCANNER_PLATFORMS = new Set(['android', 'android_x', 'ios'])

function tg(): TgScanApi | undefined {
  return (window as Window & { Telegram?: { WebApp?: TgScanApi } }).Telegram?.WebApp
}

/** Telegram's native scanner — mobile Telegram apps, Bot API ≥ 6.4. */
export function hasTelegramScanner(): boolean {
  const api = tg()
  if (typeof api?.showScanQrPopup !== 'function') return false
  if (!api.isVersionAtLeast?.('6.4')) return false
  return SCANNER_PLATFORMS.has(api.platform ?? '')
}

/**
 * Open the Telegram scanner. `onScan` decides: return `true` to accept (the popup
 * closes), `false` to keep scanning (e.g. someone scanned a non-receipt QR —
 * the seller just points the camera at the right one, no restart needed).
 */
export function openTelegramScanner(text: string, onScan: (raw: string) => boolean): boolean {
  const api = tg()
  try {
    api?.showScanQrPopup?.({ text }, (raw) => {
      if (onScan(raw)) {
        api.closeScanQrPopup?.()
        return true
      }
      return false
    })
    return true
  } catch {
    // Unsupported client or a popup already open — the caller falls back.
    return false
  }
}

export function closeTelegramScanner(): void {
  tg()?.closeScanQrPopup?.()
}

// ---- In-app camera (fallback outside the mobile Telegram scanner) ----------

interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

function barcodeDetectorCtor(): BarcodeDetectorCtor | undefined {
  return (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
}

/** Native QR detection in the browser (Chrome/Android WebView). Phase 2 adds a wasm fallback. */
export function hasCameraScanner(): boolean {
  return Boolean(barcodeDetectorCtor()) && typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
}

export function createQrDetector(): BarcodeDetectorLike | null {
  const Ctor = barcodeDetectorCtor()
  return Ctor ? new Ctor({ formats: ['qr_code'] }) : null
}
