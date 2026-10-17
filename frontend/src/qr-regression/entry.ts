/**
 * QR regression harness (dev server only, never in the build): runs the SAME code the seller's
 * phone uses on «Фото или PDF чека» — decode the file, then pick the fiscal receipt — and returns
 * a compact result for ops/regression/qr/run.mjs to compare with the dataset's expectations.
 */
import { decodeImageFile, decodePdfFile, PdfDecodeError } from '@/features/seller/qr/decode'
import { pickFiscal, sumRub, type FiscalData } from '@/features/seller/qr/fiscalQr'

export interface CheckResult {
  kind: 'one' | 'many' | 'none' | 'error'
  receipts: Array<{ fn: string; i: string; fp: string; s: string; t: string }>
  problem?: string
  ms: number
}

const brief = (d: FiscalData) => ({ fn: d.fn, i: d.fd, fp: d.fp, s: sumRub(d.totalKop), t: d.t.slice(0, 13) })

async function check(url: string, name: string): Promise<CheckResult> {
  const started = performance.now()
  try {
    const blob = await (await fetch(url)).blob()
    const texts = /\.pdf$/i.test(name) ? await decodePdfFile(blob) : await decodeImageFile(blob)
    const pick = pickFiscal(texts)
    const ms = Math.round(performance.now() - started)
    if (pick.kind === 'one') return { kind: 'one', receipts: [brief(pick.candidate.data)], ms }
    if (pick.kind === 'many') return { kind: 'many', receipts: pick.candidates.map((c) => brief(c.data)), ms }
    return { kind: 'none', receipts: [], ms }
  } catch (e) {
    const problem = e instanceof PdfDecodeError ? e.reason : e instanceof Error ? e.name : 'unknown'
    return { kind: 'error', receipts: [], problem, ms: Math.round(performance.now() - started) }
  }
}

;(window as unknown as { __qrCheck: typeof check }).__qrCheck = check
;(window as unknown as { __qrReady: boolean }).__qrReady = true
