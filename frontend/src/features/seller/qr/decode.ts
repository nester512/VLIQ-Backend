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

/** EVERY page of a PDF is scanned (the QR may be on the last one); this cap only guards
 *  the phone against a huge non-receipt document — it is far above any e-receipt. */
export const MAX_PDF_PAGES = 50

/** Why a PDF gave no codes — shown to the seller instead of a generic «не удалось». */
export type PdfProblem = 'pdf_unreadable' | 'pdf_not_rasterized' | 'pdf_too_long'

export class PdfDecodeError extends Error {
  readonly reason: PdfProblem
  constructor(reason: PdfProblem) {
    super(reason)
    this.name = 'PdfDecodeError'
    this.reason = reason
  }
}

export const PDF_PROBLEM_MESSAGE: Record<PdfProblem | 'pdf_no_qr', string> = {
  pdf_unreadable:
    'PDF не открывается (повреждён или защищён паролем). Сохраните чек заново из приложения банка или ОФД — или введите данные вручную.',
  pdf_not_rasterized: 'Не удалось отрисовать страницы PDF на этом телефоне. Сделайте скриншот чека или введите данные вручную.',
  pdf_too_long: `В PDF больше ${MAX_PDF_PAGES} страниц — это не похоже на чек. Загрузите сам чек или введите данные вручную.`,
  pdf_no_qr:
    'В PDF не найден QR-код чека. Введите данные вручную — ФН, ФД, ФП, дата и сумма напечатаны на чеке.',
}
/** Photos are decoded downscaled first (fast, low memory), then once more in more detail. */
const PHOTO_SIDES = [2048, 4096] as const
/** PDF pages are rendered so that the page width is about this many pixels… */
const PDF_TARGET_WIDTH = 1600
/** …but never above this many pixels: iOS canvases over ~16.7 MP silently render blank. */
const MAX_CANVAS_PIXELS = 12_000_000
/** Files above this size are refused before decoding (a receipt photo/PDF is far smaller). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024

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
    try {
      // Instantiate NOW (fireImmediately) so a failed wasm fetch surfaces here and
      // can be retried — a lazily failed init would be cached by the library forever.
      await reader.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path),
        },
        fireImmediately: true,
      })
    } catch (err) {
      reader.purgeZXingModule()
      throw err
    }
    return reader
  })()
  try {
    return await zxingPromise
  } catch (err) {
    zxingPromise = null // a flaky network drop: the next decode tries again
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
async function openBitmap(file: Blob): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    try {
      return await createImageBitmap(file) // older WebKit rejects the options object
    } catch {
      return null
    }
  }
}

function pixelsOf(bitmap: ImageBitmap, maxSide: number): ImageData | null {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * Photo / screenshot → QR texts. Browser-decoded (EXIF-rotated, HEIC on iOS) pixels,
 * downscaled first — a 12 MP photo at full resolution would cost ~150 MB and seconds
 * of a frozen UI; a larger pass only if the small one finds nothing. ZXing's own
 * decoder (full resolution) is the fallback where the browser cannot decode.
 */
export async function decodeImageFile(file: Blob): Promise<string[]> {
  const bitmap = await openBitmap(file)
  if (bitmap) {
    try {
      const largest = Math.max(bitmap.width, bitmap.height)
      for (const side of PHOTO_SIDES) {
        const pixels = pixelsOf(bitmap, side)
        if (pixels) {
          const texts = await readQrTexts(pixels)
          if (texts.length) return texts
        }
        if (largest <= side) break // already tried at full size
      }
      return []
    } finally {
      bitmap.close?.()
    }
  }
  return readQrTexts(file)
}

// ---- PDF -------------------------------------------------------------------

export interface PdfRenderer {
  /** Render up to `maxPages` pages, handing each page's pixels to `onPage` before the next
   *  (one page in memory at a time). */
  renderPages(data: ArrayBuffer, maxPages: number, onPage: (page: ImageData) => Promise<void>): Promise<void>
}

const pdfjsRenderer: PdfRenderer = {
  async renderPages(data, maxPages, onPage) {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    const task = pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false })
    try {
      let doc: Awaited<typeof task.promise>
      try {
        doc = await task.promise // inside try: an encrypted/broken PDF still frees the worker
      } catch {
        throw new PdfDecodeError('pdf_unreadable')
      }
      if (doc.numPages > maxPages) throw new PdfDecodeError('pdf_too_long')
      let rendered = 0
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const base = page.getViewport({ scale: 1 })
        const byWidth = PDF_TARGET_WIDTH / base.width
        const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height))
        const viewport = page.getViewport({ scale: Math.max(0.5, Math.min(4, byWidth, byArea)) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) continue
        ctx.fillStyle = '#fff' // transparent PDFs would otherwise decode as black-on-black
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
        page.cleanup()
        canvas.width = canvas.height = 0 // release the backing store before the next page
        rendered++
        await onPage(pixels)
      }
      if (rendered === 0) throw new PdfDecodeError('pdf_not_rasterized')
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
  const texts: string[] = []
  await renderer.renderPages(await file.arrayBuffer(), MAX_PDF_PAGES, async (page) => {
    texts.push(...(await read(page)))
  })
  return distinct(texts)
}

export const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

/** Anything that is not a PDF is tried as an image — some phones report HEIC/JFIF with an empty MIME. */
export const looksLikeImage = (file: File) =>
  file.type.startsWith('image/') || (file.type === '' && /\.(jpe?g|jfif|png|webp|heic|heif|gif|bmp)$/i.test(file.name))

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
