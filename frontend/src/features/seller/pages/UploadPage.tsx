import { useState, useRef, useEffect } from 'react'
import type { ReactNode, ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/atoms/Icon'
import { Btn } from '@/components/atoms/Btn'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { useUiStore } from '@/store/uiStore'
import { useUploadReceipt } from '../hooks/useUploadReceipt'
import { extractApiError } from '@/api/client'
import { getMe } from '@/api/sellers'

/** Spec cap: one submission = one Receipt with 1..5 attachments. */
const MAX_FILES = 5

/**
 * Backend error codes / HTTP statuses that are clearly about the attached
 * file(s) rather than the request as a whole. When one of these fires we show
 * the localized message inline near the selected files (best-effort) in
 * addition to the toast the hook already dispatched.
 */
const FILE_SPECIFIC_CODES = new Set([
  'RECEIPT_FILE_TOO_LARGE',
  'RECEIPT_UNSUPPORTED_MEDIA',
  'RECEIPT_INVALID_FILE',
  'RECEIPT_TOO_MANY_FILES',
])
function isFileSpecificError(code: string, status: number): boolean {
  return FILE_SPECIFIC_CODES.has(code) || status === 413 || status === 415
}

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
 * One selected attachment: the File plus an object URL for image previews
 * (`null` for PDFs, which render as a card, never as <img>). The id keys the
 * tile and lets us revoke exactly one URL on removal. Order is the array order.
 */
interface SelectedAttachment {
  id: string
  file: File
  /** Object URL for image previews; null for PDFs. */
  previewUrl: string | null
}

/** Human-readable file size (e.g. "1.2 МБ"). */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} КБ`
  return `${(kb / 1024).toFixed(1)} МБ`
}

let attachmentSeq = 0
function makeAttachment(file: File): SelectedAttachment {
  return {
    id: `att-${++attachmentSeq}`,
    file,
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
  }
}

function UploadContent() {
  const navigate = useNavigate()
  const pushToast = useUiStore((s) => s.pushToast)
  const { mutateAsync: uploadReceipt, isPending, progress } = useUploadReceipt()
  const { data: profile } = useQuery({
    queryKey: ['sellers', 'me'],
    queryFn: getMe,
    staleTime: 60_000,
  })
  // One submission = a single package: 1..5 attachments + an OPTIONAL scanned QR.
  // Files and QR are INDEPENDENT — neither clears the other.
  const [attachments, setAttachments] = useState<SelectedAttachment[]>([])
  const [scannedQr, setScannedQr] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  // Inline message shown next to the file tiles when the LAST upload failed with
  // a file-specific error (size/type). Cleared on a new send or selection edit.
  const [fileError, setFileError] = useState<string | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Keep a live ref of the current attachments so the unmount cleanup can
  // revoke their object URLs without re-running on every selection change
  // (which would revoke URLs still in use). The ref is written inside an effect
  // — never during render — and the cleanup runs only on unmount.
  const attachmentsRef = useRef<SelectedAttachment[]>([])
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])
  useEffect(() => {
    return () => {
      for (const att of attachmentsRef.current) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
      }
    }
  }, [])

  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return
    // Selection changed — a stale file-specific error no longer applies.
    setFileError(null)
    setAttachments((prev) => {
      const room = MAX_FILES - prev.length
      if (room <= 0) {
        pushToast(`Можно прикрепить не более ${MAX_FILES} файлов`, 'wn')
        return prev
      }
      const accepted = incoming.slice(0, room)
      if (incoming.length > room) {
        pushToast(`Можно прикрепить не более ${MAX_FILES} файлов`, 'wn')
      }
      // MERGE with the existing selection (additive) — do not replace.
      return [...prev, ...accepted.map(makeAttachment)]
    })
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    addFiles(files)
    // Allow re-selecting the same file path on the next pick.
    e.target.value = ''
  }

  function removeAttachment(id: string) {
    setFileError(null)
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }

  function clearAll() {
    setAttachments((prev) => {
      for (const att of prev) {
        if (att.previewUrl) URL.revokeObjectURL(att.previewUrl)
      }
      return []
    })
    setScannedQr(null)
    setUploadProgress(null)
    setFileError(null)
    if (cameraRef.current) cameraRef.current.value = ''
    if (fileRef.current) fileRef.current.value = ''
  }

  function handleQr() {
    const tgApp = (window as Window & { Telegram?: { WebApp?: TgQrApi } }).Telegram?.WebApp
    if (tgApp?.showScanQrPopup) {
      tgApp.showScanQrPopup({ text: 'Отсканируйте QR-код на чеке' }, (data) => {
        // Capture the raw QR string. It is ADDITIVE — scanning does NOT clear
        // the selected files. Telegram keeps the scanner overlay open until the
        // page explicitly closes it; close it so the captured QR surfaces.
        setScannedQr(data)
        tgApp.closeScanQrPopup?.()
      })
    } else {
      // Outside Telegram (e.g. desktop browser) there is no in-app scanner —
      // fall back to picking a photo of the receipt; the server extracts the QR.
      fileRef.current?.click()
    }
  }

  async function handleSend() {
    // At least one file is required — QR alone is NOT submittable.
    if (attachments.length === 0) return
    setUploadProgress(null)
    setFileError(null)
    try {
      // ONE request for the whole package: all files + brand_id + optional QR.
      const receipt = await uploadReceipt({
        files: attachments.map((a) => a.file),
        scannedQr: scannedQr ?? undefined,
        brandId: profile?.brand_id,
      })
      setUploadProgress(null)
      clearAll()
      navigate(`/seller/status/${receipt.id}`)
    } catch (err) {
      // Keep the selection + scanned QR so the user can retry (same idempotency
      // key held in the hook ref). Error toast is dispatched inside the hook;
      // for file-specific errors (size/type) also surface it inline.
      setUploadProgress(null)
      const { code, status, userMessage } = extractApiError(err)
      if (isFileSpecificError(code, status)) {
        setFileError(userMessage)
      }
    }
  }

  // Resolved progress: prefer real-time callback value, fall back to hook state.
  const displayProgress = uploadProgress ?? progress
  const canSubmit = attachments.length > 0
  const atCap = attachments.length >= MAX_FILES

  return (
    <div>
      {/* Upload Box */}
      <div
        className="vliq-themed"
        style={{
          margin: 16,
          border: '2px dashed var(--vliq-sep)',
          borderRadius: 20,
          padding: attachments.length > 0 ? '20px' : '34px 20px',
          textAlign: 'center',
          background: 'var(--vliq-card)',
        }}
      >
        {attachments.length > 0 ? (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vliq-text)' }}>
                Файлов: {attachments.length}/{MAX_FILES}
              </span>
              <button
                type="button"
                onClick={clearAll}
                style={{
                  background: 'transparent',
                  border: 0,
                  color: 'var(--vliq-brand)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Очистить всё
              </button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
                gap: 10,
              }}
            >
              {attachments.map((att) => (
                <div
                  key={att.id}
                  data-testid="attachment-tile"
                  style={{
                    position: 'relative',
                    borderRadius: 12,
                    overflow: 'hidden',
                    aspectRatio: '1 / 1',
                    background: 'var(--vliq-field)',
                  }}
                >
                  {att.previewUrl ? (
                    <img
                      src={att.previewUrl}
                      alt={att.file.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        padding: 6,
                        color: 'var(--vliq-hint)',
                      }}
                    >
                      <Icon name="file" size={24} />
                      <span style={{ fontSize: 10, fontWeight: 700 }}>PDF</span>
                      <span
                        style={{
                          fontSize: 9,
                          lineHeight: 1.2,
                          textAlign: 'center',
                          wordBreak: 'break-word',
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {att.file.name}
                      </span>
                      <span style={{ fontSize: 9 }}>{formatSize(att.file.size)}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label={`Удалить ${att.file.name}`}
                    onClick={() => removeAttachment(att.id)}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: 0,
                      cursor: 'pointer',
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(0,0,0,0.55)',
                      color: '#fff',
                    }}
                  >
                    <Icon name="x" size={13} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={atCap}
              onClick={() => fileRef.current?.click()}
              style={{
                marginTop: 12,
                background: 'transparent',
                border: 0,
                color: atCap ? 'var(--vliq-hint)' : 'var(--vliq-brand)',
                fontSize: 13,
                fontWeight: 600,
                cursor: atCap ? 'default' : 'pointer',
                opacity: atCap ? 0.6 : 1,
              }}
            >
              {atCap ? `Максимум ${MAX_FILES} файлов` : '+ Добавить ещё'}
            </button>
            {fileError && (
              <p
                role="alert"
                style={{
                  marginTop: 10,
                  fontSize: 12.5,
                  fontWeight: 600,
                  lineHeight: 1.35,
                  color: 'var(--color-dg)',
                }}
              >
                {fileError}
              </p>
            )}
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
              Сфотографируйте бумажный чек или прикрепите электронный (до {MAX_FILES} файлов)
            </p>
          </>
        )}
      </div>

      {/* Scanned QR — INDEPENDENT of the files; can be cleared on its own. */}
      {scannedQr && (
        <div
          className="vliq-themed"
          style={{
            margin: '0 16px',
            borderRadius: 16,
            padding: '12px 14px',
            background: 'var(--vliq-card)',
            boxShadow: 'var(--vliq-shadow-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'color-mix(in srgb, var(--color-ok) 14%, transparent)',
              color: 'var(--color-ok)',
            }}
          >
            <Icon name="qr" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--vliq-text)' }}>
              QR-код отсканирован
            </p>
            <p
              style={{
                fontSize: 11,
                color: 'var(--vliq-hint)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {scannedQr}
            </p>
          </div>
          <button
            type="button"
            aria-label="Убрать QR-код"
            onClick={() => setScannedQr(null)}
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--vliq-brand)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            Убрать
          </button>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={handleFileChange} />
      <input ref={fileRef}   type="file" accept="image/*,application/pdf"       multiple hidden onChange={handleFileChange} />

      {/* Options */}
      <div style={{ display: 'flex', gap: 10, padding: '0 16px', marginTop: scannedQr ? 12 : 6 }}>
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

        {/* Upload progress bar — visible only during the package upload */}
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
          <Btn loading={isPending} disabled={isPending || !canSubmit} onClick={() => void handleSend()}>
            {canSubmit ? 'Отправить чек' : 'Выберите файл'}
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
