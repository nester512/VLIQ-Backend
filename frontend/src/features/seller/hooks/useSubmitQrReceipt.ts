import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { submitQrReceipt, type ReceiptSource } from '@/api/receipts'
import { useUiStore } from '@/store/uiStore'
import { randomId, shortHash } from '@/utils/randomId'
import { canonicalQr, fiscalKey, sumRub, type FiscalData } from '../qr/fiscalQr'
import { rememberSent } from '../qr/sentReceipts'

const DEFAULT_BRAND_ID = 1

export interface SubmitQrArgs {
  data: FiscalData
  source: ReceiptSource
  rawQr?: string
  brandId?: number
}

/**
 * Idempotency key = page-session nonce + fiscal identity + hash of the FULL data.
 * A retry of exactly the same data after a network error returns the same server
 * receipt; corrected data (another sum/date) is a new request; a deliberate resend
 * later gets a new nonce (resubmission after a rejection is allowed by the BRD).
 * Length: 12 + 1 + 16 + 1 + 10 + 1 + 10 + 1 + 8 = 60 ≤ 64.
 */
export function idempotencyKey(nonce: string, data: FiscalData): string {
  return `${nonce}:${fiscalKey(data)}:${shortHash(canonicalQr(data))}`
}

/** Send ONE receipt as dry fiscal data (`POST /receipts/qr`). */
export function useSubmitQrReceipt() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const nonceRef = useRef<string | null>(null)

  return useMutation({
    mutationFn: ({ data, source, rawQr, brandId }: SubmitQrArgs) => {
      nonceRef.current ??= randomId(12)
      return submitQrReceipt({
        brand_id: brandId ?? DEFAULT_BRAND_ID,
        source,
        fn: data.fn,
        fd: data.fd,
        fp: data.fp,
        t: data.t,
        s: sumRub(data.totalKop),
        n: data.operationType,
        qr_raw: rawQr,
        idempotency_key: idempotencyKey(nonceRef.current, data),
      })
    },
    onSuccess: (result, { data }) => {
      nonceRef.current = null
      rememberSent(fiscalKey(data))
      void queryClient.invalidateQueries({ queryKey: ['receipts'] })
      void queryClient.invalidateQueries({ queryKey: ['balance'] })
      pushToast('Чек отправлен на проверку', 'ok')
      for (const w of result.warnings) pushToast(w.message, 'wn')
    },
  })
}
