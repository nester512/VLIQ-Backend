import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { submitQrPayload, uploadReceipt, getUploadUrl, finalizeUpload } from '@/api/receipts'
import { extractApiError } from '@/api/client'
import { useUiStore } from '@/store/uiStore'

// Fallback brand_id when the seller profile hasn't loaded yet.
// Matches the auth handler default (`brand_id=1` in `_issue_token_for_telegram_id`).
const DEFAULT_BRAND_ID = 1

export interface UploadReceiptArgs {
  /** File to upload (image / PDF). Mutually exclusive with qrRaw. */
  file?: File
  /** Raw QR string from the Telegram in-app scanner. Mutually exclusive with file. */
  qrRaw?: string
  brandId?: number
  /** Called repeatedly during the S3 XHR upload with percentage 0-100. */
  onProgress?: (pct: number) => void
}

/**
 * Upload a file directly to S3 via a presigned POST URL, reporting progress.
 * Uses XHR (not axios/fetch) because XHR exposes the upload progress event.
 */
function uploadToS3(
  uploadUrl: string,
  fields: Record<string, string>,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData()
    // S3 presigned POST requires all policy fields BEFORE the file.
    for (const [k, v] of Object.entries(fields)) {
      formData.append(k, v)
    }
    formData.append('file', file)

    const xhr = new XMLHttpRequest()

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100))
        }
      })
    }

    xhr.addEventListener('load', () => {
      // S3 presigned POST returns 204 No Content on success.
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`S3 upload failed: HTTP ${xhr.status}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('S3 upload network error')))
    xhr.addEventListener('abort', () => reject(new Error('S3 upload aborted')))

    xhr.open('POST', uploadUrl)
    xhr.send(formData)
  })
}

export function useUploadReceipt() {
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const [progress, setProgress] = useState<number | null>(null)

  const mutation = useMutation({
    mutationFn: async ({ file, qrRaw, brandId, onProgress }: UploadReceiptArgs) => {
      const effectiveBrandId = brandId ?? DEFAULT_BRAND_ID

      if (qrRaw) {
        // QR string scanned by Telegram in-app scanner → dedicated endpoint.
        return submitQrPayload(qrRaw, effectiveBrandId)
      }

      if (!file) {
        return Promise.reject(new Error('Either file or qrRaw must be provided'))
      }

      // Try the presigned S3 flow first. Fall back to legacy multipart if the
      // backend does not support presigned uploads (e.g. local storage backend,
      // endpoint not yet deployed, or 404/501 from the upload-url step).
      try {
        // Step 1: Mint presigned POST URL.
        const { upload_url, fields, storage_uri } = await getUploadUrl(file.type)

        // Step 2: Upload directly to S3 via XHR (progress tracking).
        const handleProgress = (pct: number) => {
          setProgress(pct)
          onProgress?.(pct)
        }
        await uploadToS3(upload_url, fields, file, handleProgress)
        setProgress(100)

        // Step 3: Notify backend — create receipt row + enqueue pipeline.
        return finalizeUpload(storage_uri, file.type, effectiveBrandId)
      } catch (presignedErr) {
        // Fall back to legacy multipart upload when the presigned endpoint is
        // unavailable (not deployed: 404, local storage backend: 501, or any
        // network-level failure before the presigned POST is minted).
        // Do NOT fall back on 400/415/403 — those indicate genuine validation
        // or auth errors that must surface to the user.
        const axiosStatus =
          presignedErr != null &&
          typeof presignedErr === 'object' &&
          'response' in presignedErr
            ? (presignedErr as { response?: { status?: number } }).response?.status
            : undefined

        const shouldFallback =
          axiosStatus === 404 ||
          axiosStatus === 501 ||
          // Network error before any HTTP response (axiosStatus undefined + no 'response')
          (axiosStatus == null &&
            presignedErr != null &&
            typeof presignedErr === 'object' &&
            !('response' in presignedErr))

        if (shouldFallback) {
          setProgress(null)
          return uploadReceipt(file, effectiveBrandId)
        }

        // For 400, 415, 403 and S3-level failures — re-throw to show the user.
        throw presignedErr
      }
    },
    onSuccess: () => {
      setProgress(null)
      void queryClient.invalidateQueries({ queryKey: ['receipts'] })
      void queryClient.invalidateQueries({ queryKey: ['balance'] })
      pushToast('Чек успешно загружен', 'ok')
    },
    onError: (err: unknown) => {
      setProgress(null)
      // Surface the backend's user_message (e.g. "Этот чек уже был загружен
      // ранее.") instead of a generic toast. Falls back to a default string
      // when the error carries no envelope.
      const { userMessage } = extractApiError(err)
      pushToast(userMessage || 'Ошибка загрузки чека. Попробуйте снова.', 'dg')
    },
  })

  return { ...mutation, progress }
}
