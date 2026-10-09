/**
 * QR decoding ON THE DEVICE (phase 2, docs/design/QR-INTAKE.md): photos,
 * screenshots and PDFs become QR text locally — nothing but the resulting
 * fiscal data is ever sent.
 *
 * Engines are loaded lazily, only when the seller picks a file / opens the
 * camera: ZXing C++ compiled to WebAssembly (`zxing-wasm`, ~1 MB wasm served
 * from our own origin — never a CDN) and pdf.js (legacy build, for older
 * Telegram WebViews) to rasterise PDF pages.
 */
import type { ReaderOptions } from 'zxing-wasm/reader'

type ZXingReader = typeof import('zxing-wasm/reader')

/** Pages of a PDF that are rendered and scanned (an e-receipt is 1–2 pages). */
export const MAX_PDF_PAGES = 5
/** Longest side of the bitmap handed to the decoder for photos (speed vs. detail). */
const PHOTO_MAX_SIDE = 2048
/** PDF pages are rendered so that the page width is about this many pixels. */
const PDF_TARGET_WIDTH = 1600

const READER_OPTIONS: ReaderOptions = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  maxNumberOfSymbols: 8,
}

let zxingPromise: Promise<ZXingReader> | null = null

/** Test seam: inject a ready module (e.g. with the wasm binary loaded from disk). */
export function setZXingReaderForTests(reader: ZXingReader | null): void {
  zxingPromise = reader ? Promise.resolve(reader) : null
}

async function zxing(): Promise<ZXingReader> {
  zxingPromise ??= (async () => {
    const [reader, wasm] = await Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])
    reader.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path),
      },
    })
    return reader
  })()
  try {
    return await zxingPromise
  } catch (err) {
    zxingPromise = null // a failed load (offline) may succeed on the next attempt
    throw err
  }
}

const distinct = (texts: string[]) => [...new Set(texts.map((t) => t.trim()).filter(Boolean))]

/** Decode every QR in an image Blob (PNG/JPEG/WebP…) or raw pixels. */
export async function readQrTexts(input: Blob | ImageData, options: ReaderOptions = READER_OPTIONS): Promise<string[]> {
  const reader = await zxing()
  const results = await reader.readBarcodes(input, options)
  return distinct(results.filter((r) => r.isValid).map((r) => r.text))
}

// ---- Photos / screenshots --------------------------------------------------

/** Browser-decoded, EXIF-rotated, downscaled pixels (handles HEIC where the browser can). */
async function bitmapPixels(file: Blob, maxSide: number): Promise<ImageData | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return null
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

export async function decodeImageFile(file: Blob): Promise<string[]> {
  // 1) ZXing decodes PNG/JPEG itself at full resolution — best for small/blurry codes.
  try {
    const texts = await readQrTexts(file)
    if (texts.length) return texts
  } catch {
    /* format ZXing cannot read (e.g. HEIC) → let the browser decode it below */
  }
  // 2) Browser-decoded pixels (EXIF rotation, HEIC on iOS), downscaled.
  const pixels = await bitmapPixels(file, PHOTO_MAX_SIDE)
  return pixels ? readQrTexts(pixels) : []
}

// ---- PDF -------------------------------------------------------------------

export interface PdfRenderer {
  /** Render up to `maxPages` pages to pixels. */
  renderPages(data: ArrayBuffer, maxPages: number): Promise<ImageData[]>
}

const pdfjsRenderer: PdfRenderer = {
  async renderPages(data, maxPages) {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const task = pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false })
    const doc = await task.promise
    try {
      const pages: ImageData[] = []
      for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(4, PDF_TARGET_WIDTH / base.width) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) continue
        ctx.fillStyle = '#fff' // transparent PDFs would otherwise decode as black-on-black
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        pages.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
        page.cleanup()
      }
      return pages
    } finally {
      await task.destroy()
    }
  },
}

export async function decodePdfFile(
  file: Blob,
  renderer: PdfRenderer = pdfjsRenderer,
  read: (page: ImageData) => Promise<string[]> = (page) => readQrTexts(page),
): Promise<string[]> {
  const pages = await renderer.renderPages(await file.arrayBuffer(), MAX_PDF_PAGES)
  const texts: string[] = []
  for (const page of pages) texts.push(...(await read(page)))
  return distinct(texts)
}

export const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

// ---- Camera frames (fallback where BarcodeDetector is missing, e.g. iOS) ----

const CAMERA_OPTIONS: ReaderOptions = { formats: ['QRCode'], tryHarder: false, maxNumberOfSymbols: 4 }
const CAMERA_MAX_SIDE = 1024

/** A BarcodeDetector-shaped detector backed by ZXing-wasm. */
export function createWasmQrDetector() {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
  const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null
  return {
    async detect(video: HTMLVideoElement): Promise<Array<{ rawValue: string }>> {
      if (!canvas || !ctx || !video.videoWidth) return []
      const scale = Math.min(1, CAMERA_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.round(video.videoWidth * scale)
      canvas.height = Math.round(video.videoHeight * scale)
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const texts = await readQrTexts(ctx.getImageData(0, 0, canvas.width, canvas.height), CAMERA_OPTIONS)
      return texts.map((rawValue) => ({ rawValue }))
    },
  }
}
