import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { submitQrReceipt, type ReceiptSource } from '@/api/receipts'
import { useUiStore } from '@/store/uiStore'
import { fiscalKey, sumRub, type FiscalData } from '../qr/fiscalQr'
import { rememberSent } from '../qr/sentReceipts'

const DEFAULT_BRAND_ID = 1

export interface SubmitQrArgs {
  data: FiscalData
  source: ReceiptSource
  rawQr?: string
  brandId?: number
}

/**
 * Send ONE receipt as dry fiscal data (`POST /receipts/qr`).
 *
 * Idempotency key = this page session's nonce + the fiscal identity: a retry of
 * the same receipt after a network error returns the same server receipt, while a
 * deliberate resend later (e.g. after a rejection — allowed by the BRD) gets a new
 * nonce and creates a new one.
 */
export function useSubmitQrReceipt() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const nonceRef = useRef(crypto.randomUUID().slice(0, 18))

  return useMutation({
    mutationFn: ({ data, source, rawQr, brandId }: SubmitQrArgs) =>
      submitQrReceipt({
        brand_id: brandId ?? DEFAULT_BRAND_ID,
        source,
        fn: data.fn,
        fd: data.fd,
        fp: data.fp,
        t: data.t,
        s: sumRub(data.totalKop),
        n: data.operationType,
        qr_raw: rawQr,
        idempotency_key: `${nonceRef.current}:${fiscalKey(data)}`,
      }),
    onSuccess: (result, { data }) => {
      nonceRef.current = crypto.randomUUID().slice(0, 18)
      rememberSent(fiscalKey(data))
      void queryClient.invalidateQueries({ queryKey: ['receipts'] })
      void queryClient.invalidateQueries({ queryKey: ['balance'] })
      pushToast('Чек отправлен на проверку', 'ok')
      for (const w of result.warnings) pushToast(w.message, 'wn')
    },
  })
}
