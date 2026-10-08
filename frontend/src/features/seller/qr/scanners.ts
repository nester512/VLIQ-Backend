/**
 * QR sources on the device. The decoded string is validated by the caller
 * (`parseQr`) — a scanner only reports what it saw.
 */

interface TgScanApi {
  showScanQrPopup?: (p: { text?: string }, cb?: (data: string) => boolean | void) => void
  closeScanQrPopup?: () => void
}

function tg(): TgScanApi | undefined {
  return (window as Window & { Telegram?: { WebApp?: TgScanApi } }).Telegram?.WebApp
}

/** Telegram's native scanner — available in the mobile Telegram apps. */
export function hasTelegramScanner(): boolean {
  return typeof tg()?.showScanQrPopup === 'function'
}

/**
 * Open the Telegram scanner. `onScan` decides: return `true` to accept (the popup
 * closes), `false` to keep scanning (e.g. someone scanned a non-receipt QR —
 * the seller just points the camera at the right one, no restart needed).
 */
export function openTelegramScanner(text: string, onScan: (raw: string) => boolean): void {
  const api = tg()
  api?.showScanQrPopup?.({ text }, (raw) => {
    if (onScan(raw)) {
      api.closeScanQrPopup?.()
      return true
    }
    return false
  })
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
