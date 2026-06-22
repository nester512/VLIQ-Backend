import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { uploadReceiptPackage } from '@/api/receipts'
import { extractApiError } from '@/api/client'
import { useUiStore } from '@/store/uiStore'

// Fallback brand_id when the seller profile hasn't loaded yet.
// Matches the auth handler default (`brand_id=1` in `_issue_token_for_telegram_id`).
const DEFAULT_BRAND_ID = 1

export interface UploadReceiptArgs {
  /** 1..5 attachments (images and/or PDFs) submitted as ONE receipt package. */
  files: File[]
  /** Optional raw QR string from the Telegram in-app scanner. */
  scannedQr?: string
  brandId?: number
}

/**
 * Submit a receipt package (1..5 files + optional scanned QR) as a SINGLE
 * `POST /receipts/upload` request — one submission = one Receipt.
 *
 * Idempotency: the key is generated once per submission attempt and held in a
 * ref. The hook only rotates it after a SUCCESSFUL submission, so a retry of a
 * failed submission reuses the same key and the backend returns the same
 * receipt instead of creating a duplicate. The user's selection is never wiped
 * on a transient error (that is the page's responsibility — the hook keeps the
 * key stable so retrying is safe).
 */
export function useUploadReceipt() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const [progress, setProgress] = useState<number | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)

  const mutation = useMutation({
    mutationFn: ({ files, scannedQr, brandId }: UploadReceiptArgs) => {
      const effectiveBrandId = brandId ?? DEFAULT_BRAND_ID
      // Reuse the existing key across retries of the same submission; mint a
      // fresh one only for the first attempt (cleared on success below).
      if (idempotencyKeyRef.current === null) {
        idempotencyKeyRef.current = crypto.randomUUID()
      }
      return uploadReceiptPackage(files, {
        brandId: effectiveBrandId,
        scannedQr,
        idempotencyKey: idempotencyKeyRef.current,
        onProgress: setProgress,
      })
    },
    onSuccess: (result) => {
      setProgress(null)
      // Rotate the key so the NEXT submission is treated as a new package.
      idempotencyKeyRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['receipts'] })
      void queryClient.invalidateQueries({ queryKey: ['balance'] })
      pushToast('Чек успешно загружен', 'ok')
      // Non-blocking advisories (e.g. POSSIBLE_DUPLICATE): the submission still
      // succeeded — show each as a warning toast; navigation proceeds upstream.
      for (const warning of result.warnings) {
        pushToast(warning.message, 'wn')
      }
    },
    onError: (err: unknown) => {
      setProgress(null)
      // Keep idempotencyKeyRef so a retry reuses the same key (no duplicate).
      // Surface the backend's user_message (e.g. validation/size errors)
      // instead of a generic toast.
      const { userMessage } = extractApiError(err)
      pushToast(userMessage || 'Ошибка загрузки чека. Попробуйте снова.', 'dg')
    },
  })

  return { ...mutation, progress }
}
