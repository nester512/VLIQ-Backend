// @vitest-environment node
/// <reference types="node" />
/**
 * Real decoding with the SAME ZXing-wasm engine the phone runs: a fiscal QR is
 * rendered by ZXing's writer and read back by our decode functions.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import * as reader from 'zxing-wasm/reader'
import * as writer from 'zxing-wasm/writer'
import { decodeImageFile, decodePdfFile, PDF_PROBLEM_MESSAGE, PdfDecodeError, readQrTexts, setZXingReaderForTests } from './decode'
import { pickFiscal } from './fiscalQr'

const require = createRequire(import.meta.url)
const wasm = (name: string) => readFileSync(require.resolve(`zxing-wasm/${name}`))

const FISCAL = 't=20261008T1432&s=1450.00&fn=9960440300712345&i=12345&fp=3826178549&n=1'
const NOW = new Date(Date.UTC(2026, 9, 8, 12, 0))

// Minimal ImageData for Node (browsers have it natively).
class NodeImageData {
  readonly colorSpace = 'srgb'
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

/** RGBA pixels of a code, scaled ×scale with a white quiet zone — like a rendered PDF page. */
async function pixelsOf(text: string, format: 'QRCode' | 'EAN13' = 'QRCode', scale = 4): Promise<ImageData> {
  const { symbol, error } = await writer.writeBarcode(text, { format, scale: 1 })
  if (error) throw new Error(error)
  const pad = 8
  const w = (symbol.width + pad * 2) * scale
  const h = (symbol.height + pad * 2) * scale
  const out = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 0; y < symbol.height; y++) {
    for (let x = 0; x < symbol.width; x++) {
      if (symbol.data[y * symbol.width + x]! >= 128) continue // white module
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + pad) * scale + dy) * w + (x + pad) * scale + dx) * 4
          out[i] = out[i + 1] = out[i + 2] = 0
        }
      }
    }
  }
  return new NodeImageData(out, w, h) as unknown as ImageData
}

async function pngOf(text: string): Promise<Blob> {
  const { image, error } = await writer.writeBarcode(text, { format: 'QRCode', scale: 6 })
  if (!image) throw new Error(error)
  return image
}

beforeAll(async () => {
  await writer.prepareZXingModule({ overrides: { wasmBinary: wasm('writer/zxing_writer.wasm') }, fireImmediately: true })
  await reader.prepareZXingModule({ overrides: { wasmBinary: wasm('reader/zxing_reader.wasm') }, fireImmediately: true })
  setZXingReaderForTests(reader)
})

describe('decodeImageFile — photo / screenshot', () => {
  it('reads a fiscal QR from a PNG and it passes fiscal validation', async () => {
    const texts = await decodeImageFile(await pngOf(FISCAL))
    expect(texts).toEqual([FISCAL])
    const picked = pickFiscal(texts, NOW)
    expect(picked.kind).toBe('one')
  })

  it('returns nothing for an image without a QR code', async () => {
    const { image } = await writer.writeBarcode('4006381333931', { format: 'EAN13', scale: 4 })
    expect(await decodeImageFile(image!)).toEqual([])
  })

  it('reads raw pixels (the camera / PDF path)', async () => {
    expect(await readQrTexts(await pixelsOf(FISCAL))).toEqual([FISCAL])
  })
})

/** A white page with no code on it (jsdom has no ImageData constructor). */
const blankPage = () => ({ data: new Uint8ClampedArray(40 * 40 * 4).fill(255), width: 40, height: 40, colorSpace: 'srgb' }) as ImageData

describe('decodePdfFile', () => {
  const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' })

  it('scans every rendered page and merges the codes', async () => {
    const other = FISCAL.replace('i=12345', 'i=777')
    const pages = [await pixelsOf(FISCAL), await pixelsOf('https://ofd.ru/x'), await pixelsOf(other)]
    const renderer = {
      renderPages: async (_d: ArrayBuffer, _max: number, onPage: (p: ImageData) => Promise<void>) => {
        for (const p of pages) await onPage(p)
      },
    }
    const texts = await decodePdfFile(pdf, renderer)
    expect(texts).toEqual([FISCAL, 'https://ofd.ru/x', other])
    const picked = pickFiscal(texts, NOW)
    expect(picked.kind).toBe('many') // two different receipts → the seller chooses
  })

  it('scans every page — the QR on page 7 of 7 is found', async () => {
    const blank = blankPage()
    const pages = [...Array(6).fill(blank), await pixelsOf(FISCAL)]
    let asked = 0
    const renderer = {
      renderPages: async (_d: ArrayBuffer, max: number, onPage: (p: ImageData) => Promise<void>) => {
        asked = max
        for (const p of pages.slice(0, max)) await onPage(p)
      },
    }
    expect(await decodePdfFile(pdf, renderer)).toEqual([FISCAL])
    expect(asked).toBeGreaterThanOrEqual(50) // not the old 5-page cut
  })

  it('a broken / password PDF and an unrenderable one say why, not «не удалось»', async () => {
    for (const reason of ['pdf_unreadable', 'pdf_not_rasterized', 'pdf_too_long'] as const) {
      const renderer = { renderPages: async () => { throw new PdfDecodeError(reason) } }
      await expect(decodePdfFile(pdf, renderer)).rejects.toMatchObject({ reason })
      expect(PDF_PROBLEM_MESSAGE[reason]).toMatch(/вручную/)
    }
  })

  it('a PDF without a QR yields no codes (the page shows the PDF hint, not «снимите ближе»)', async () => {
    const renderer = { renderPages: async (_d: ArrayBuffer, _m: number, onPage: (p: ImageData) => Promise<void>) => onPage(blankPage()) }
    expect(await decodePdfFile(pdf, renderer)).toEqual([])
    expect(PDF_PROBLEM_MESSAGE.pdf_no_qr).toMatch(/В PDF не найден QR-код/)
  })
})
