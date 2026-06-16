import { useState, useRef, useEffect } from 'react'
import type { ReactNode, ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/atoms/Icon'
import { Btn } from '@/components/atoms/Btn'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { useUploadReceipt } from '../hooks/useUploadReceipt'
import { getMe } from '@/api/sellers'

interface OptionBtnProps {
  icon: ReactNode
  label: string
  color: string
  onClick: () => void
}

function OptionBtn({ icon, label, color, onClick }: OptionBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="vliq-themed vliq-press"
      style={{
        flex: 1,
        background: 'var(--vliq-card)',
        borderRadius: 16,
        padding: '14px 8px',
        textAlign: 'center',
        boxShadow: 'var(--vliq-shadow-sm)',
        cursor: 'pointer',
        border: 0,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          margin: '0 auto 8px',
          background: `color-mix(in srgb, var(${color}) 14%, transparent)`,
          color: `var(${color})`,
        }}
      >
        {icon}
      </div>
      <b style={{ fontSize: 12, fontWeight: 700, color: 'var(--vliq-text)' }}>{label}</b>
    </button>
  )
}

const CHECK_ITEMS = [
  { icon: 'clock' as const, label: 'Дата и сумма покупки' },
  { icon: 'store' as const, label: 'Магазин и торговая точка' },
  { icon: 'shield' as const, label: 'Уникальность чека (антифрод)' },
  { icon: 'gift' as const, label: 'Соответствие условиям акции' },
]

interface TgQrApi {
  showScanQrPopup?: (p: { text?: string }, cb?: (data: string) => void) => void
  closeScanQrPopup?: () => void
}

/**
 * S3.3 client-side pre-check: does this image contain a QR code?
 *
 * Uses the native BarcodeDetector when available (Chromium / Telegram WebView).
 * Returns:
 *   - true / false when detection actually ran;
 *   - null when detection is unsupported or the file is not an image — the
 *     caller treats null as "cannot tell", so no false warning is shown.
 * Non-blocking: the upload is allowed regardless of the result.
 */
async function imageHasQr(file: File): Promise<boolean | null> {
  const BD = (window as unknown as { BarcodeDetector?: new (o?: { formats?: string[] }) => { detect: (s: ImageBitmapSource) => Promise<unknown[]> } }).BarcodeDetector
  if (!BD || typeof createImageBitmap !== 'function' || !file.type.startsWith('image/')) {
    return null
  }
  try {
    const detector = new BD({ formats: ['qr_code'] })
    const bitmap = await createImageBitmap(file)
    const codes = await detector.detect(bitmap)
    ;(bitmap as { close?: () => void }).close?.()
    return codes.length > 0
  } catch {
    return null
  }
}

function UploadContent() {
  const navigate = useNavigate()
  const { mutateAsync: uploadReceipt, isPending, progress } = useUploadReceipt()
  const { data: profile } = useQuery({
    queryKey: ['sellers', 'me'],
    queryFn: getMe,
    staleTime: 60_000,
  })
  const [preview, setPreview] = useState<string | null>(null)
  // Multiple photos / PDFs per submission (spec S3.2 «одно или несколько»).
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [scannedQr, setScannedQr] = useState<string | null>(null)
  const [qrWarning, setQrWarning] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Revoke any outstanding blob URL on unmount or when preview changes.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    if (preview) URL.revokeObjectURL(preview)
    setScannedQr(null)
    setSelectedFiles(files)
    const firstImage = files.find((f) => f.type.startsWith('image/'))
    setPreview(firstImage ? URL.createObjectURL(firstImage) : null)
    // S3.3: warn (non-blocking) if the photo has no detectable QR code.
    setQrWarning(false)
    if (firstImage) {
      void imageHasQr(firstImage).then((found) => {
        if (found === false) setQrWarning(true)
      })
    }
  }

  function clearSelection() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setSelectedFiles([])
    setScannedQr(null)
    setQrWarning(false)
    setUploadProgress(null)
    if (cameraRef.current) cameraRef.current.value = ''
    if (fileRef.current)   fileRef.current.value = ''
  }

  function handleQr() {
    const tgApp = (window as Window & { Telegram?: { WebApp?: TgQrApi } }).Telegram?.WebApp
    if (tgApp?.showScanQrPopup) {
      tgApp.showScanQrPopup({ text: 'Отсканируйте QR-код на чеке' }, (data) => {
        // Capture the raw QR string (submitted later via the dedicated
        // /qr-payload endpoint, not as a file). Telegram keeps the scanner
        // overlay open until the page explicitly closes it — without this the
        // popup stays on top of the Mini App, so the user never sees the
        // "QR отсканирован" screen or the send button ("находит, но не
        // отправляет"). Close it so the captured QR surfaces in the UI.
        setScannedQr(data)
        setSelectedFiles([])
        setPreview(null)
        setQrWarning(false)
        tgApp.closeScanQrPopup?.()
      })
    } else {
      // Outside Telegram (e.g. desktop browser) there is no in-app scanner —
      // fall back to picking a photo of the receipt; the server extracts the QR.
      fileRef.current?.click()
    }
  }

  async function handleSend() {
    if (selectedFiles.length === 0 && !scannedQr) return
    setUploadProgress(null)
    try {
      // QR-scan path → single /qr-payload submission.
      if (scannedQr) {
        const receipt = await uploadReceipt({ qrRaw: scannedQr, brandId: profile?.brand_id })
        clearSelection()
        navigate(`/seller/status/${receipt.id}`)
        return
      }

      // Photo / PDF path → upload each selected file (one receipt per file).
      let firstId: string | null = null
      for (const file of selectedFiles) {
        const receipt = await uploadReceipt({
          file,
          brandId: profile?.brand_id,
          onProgress: (pct) => setUploadProgress(pct),
        })
        if (firstId === null) firstId = receipt.id
      }
      setUploadProgress(null)
      clearSelection()
      if (firstId) navigate(`/seller/status/${firstId}`)
    } catch {
      setUploadProgress(null)
      // Error toast is dispatched inside the hook.
    }
  }

  // Resolved progress: prefer real-time callback value, fall back to hook state.
  const displayProgress = uploadProgress ?? progress
  const hasSelection = selectedFiles.length > 0 || Boolean(scannedQr)

  return (
    <div>
      {/* Upload Box */}
      <div
        className="vliq-themed"
        style={{
          margin: 16,
          border: '2px dashed var(--vliq-sep)',
          borderRadius: 20,
          padding: '34px 20px',
          textAlign: 'center',
          background: 'var(--vliq-card)',
        }}
      >
        {scannedQr ? (
          <div>
            <p style={{ fontSize: 13, color: 'var(--vliq-hint)', marginTop: 10, fontWeight: 500 }}>
              QR-код отсканирован
            </p>
            <p style={{ fontSize: 11, color: 'var(--vliq-hint)', wordBreak: 'break-all', marginTop: 4 }}>
              {scannedQr.slice(0, 80)}{scannedQr.length > 80 ? '…' : ''}
            </p>
            <button
              type="button"
              onClick={clearSelection}
              style={{
                marginTop: 8,
                background: 'transparent',
                border: 0,
                color: 'var(--vliq-brand)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Очистить
            </button>
          </div>
        ) : selectedFiles.length > 0 ? (
          <div>
            {preview ? (
              <img
                src={preview}
                alt="Превью чека"
                style={{
                  display: 'block',
                  maxHeight: 240,
                  maxWidth: '100%',
                  margin: '0 auto',
                  borderRadius: 12,
                  objectFit: 'contain',
                }}
              />
            ) : (
              <div
                style={{
                  width: 64, height: 64, borderRadius: 20, margin: '0 auto',
                  display: 'grid', placeItems: 'center',
                  background: 'var(--vliq-field)', color: 'var(--vliq-hint)',
                }}
              >
                <Icon name="file" size={28} />
              </div>
            )}
            <p style={{ fontSize: 13, color: 'var(--vliq-hint)', marginTop: 10, fontWeight: 500 }}>
              {selectedFiles.length === 1
                ? (selectedFiles[0]?.name ?? 'Файл выбран')
                : `Выбрано файлов: ${selectedFiles.length}`}
            </p>
            {qrWarning && (
              <p
                style={{
                  fontSize: 12, fontWeight: 500, lineHeight: 1.4, marginTop: 8,
                  padding: '8px 12px', borderRadius: 10, textAlign: 'left',
                  background: 'var(--vliq-wn-bg)', color: 'var(--vliq-wn-ink)',
                }}
              >
                QR-код на фото не найден. Чек всё равно можно отправить — мы проверим его вручную.
              </p>
            )}
            <button
              type="button"
              onClick={clearSelection}
              style={{
                marginTop: 8,
                background: 'transparent',
                border: 0,
                color: 'var(--vliq-brand)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Выбрать другой файл
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                background: 'var(--vliq-brand)',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                margin: '0 auto 14px',
                boxShadow: '0 16px 30px -14px var(--vliq-brand)',
              }}
            >
              <Icon name="camera" size={28} />
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.2px', color: 'var(--vliq-text)' }}>
              Загрузите чек
            </h2>
            <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--vliq-hint)', marginTop: 6, lineHeight: 1.4 }}>
              Сфотографируйте бумажный чек или прикрепите электронный
            </p>
          </>
        )}
      </div>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={handleFileChange} />
      <input ref={fileRef}   type="file" accept="image/*,application/pdf"       multiple hidden onChange={handleFileChange} />

      {/* Options */}
      <div style={{ display: 'flex', gap: 10, padding: '0 16px', marginTop: 6 }}>
        <OptionBtn icon={<Icon name="camera" size={20} />} label="Камера"      color="--vliq-brand" onClick={() => cameraRef.current?.click()} />
        <OptionBtn icon={<Icon name="file"   size={20} />} label="PDF / файл"  color="--color-acc"  onClick={() => fileRef.current?.click()} />
        <OptionBtn icon={<Icon name="qr"     size={20} />} label="QR-код"      color="--color-ok"   onClick={handleQr} />
      </div>

      <div className="vliq-pad">
        <div className="vliq-sec-t">
          <b>Что проверит система</b>
        </div>
        <div className="vliq-list">
          {CHECK_ITEMS.map((item) => (
            <div key={item.label} className="vliq-row is-static">
              <div className="vliq-row-ic" style={{ background: 'var(--vliq-field)', color: 'var(--vliq-hint)' }}>
                <Icon name={item.icon} size={21} />
              </div>
              <div className="vliq-row-tx">
                <b style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</b>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            borderRadius: 16,
            padding: '14px 16px',
            marginTop: 14,
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--vliq-text)',
            background: 'color-mix(in srgb, var(--vliq-brand) 10%, transparent)',
            lineHeight: 1.4,
          }}
        >
          После загрузки бот ответит: «Чек получен. Проверим его и сообщим результат.»
        </div>

        {/* Upload progress bar — visible only during S3 direct upload */}
        {isPending && displayProgress !== null && (
          <div
            aria-label="Прогресс загрузки"
            style={{
              marginTop: 14,
              borderRadius: 8,
              overflow: 'hidden',
              background: 'var(--vliq-field)',
              height: 8,
            }}
          >
            <div
              role="progressbar"
              aria-valuenow={displayProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: '100%',
                width: `${displayProgress}%`,
                background: 'var(--vliq-brand)',
                borderRadius: 8,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        )}
        {isPending && displayProgress !== null && (
          <p
            style={{
              textAlign: 'center',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--vliq-hint)',
              marginTop: 6,
            }}
          >
            Загрузка… {displayProgress}%
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          <Btn loading={isPending} disabled={isPending || !hasSelection} onClick={() => void handleSend()}>
            {hasSelection ? 'Отправить чек' : 'Выберите файл'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

export function UploadPage() {
  return (
    <ErrorBoundary>
      <UploadContent />
    </ErrorBoundary>
  )
}
