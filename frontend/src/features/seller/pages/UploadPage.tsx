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
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [scannedQr, setScannedQr] = useState<string | null>(null)
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
    const file = e.target.files?.[0]
    if (!file) return
    if (preview) URL.revokeObjectURL(preview)
    setSelectedFile(file)
    setPreview(URL.createObjectURL(file))
  }

  function clearSelection() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setSelectedFile(null)
    setScannedQr(null)
    setUploadProgress(null)
    if (cameraRef.current) cameraRef.current.value = ''
    if (fileRef.current)   fileRef.current.value = ''
  }

  function handleQr() {
    const tgApp = (window as Window & { Telegram?: { WebApp?: TgQrApi } }).Telegram?.WebApp
    if (tgApp?.showScanQrPopup) {
      tgApp.showScanQrPopup({ text: 'Отсканируйте QR-код на чеке' }, (data) => {
        // Send raw QR string via dedicated /qr-payload endpoint, not as a file.
        setScannedQr(data)
        setSelectedFile(null)
        setPreview(null)
      })
    } else {
      fileRef.current?.click()
    }
  }

  async function handleSend() {
    if (!selectedFile && !scannedQr) return
    setUploadProgress(null)
    try {
      const receipt = await uploadReceipt({
        file: selectedFile ?? undefined,
        qrRaw: scannedQr ?? undefined,
        brandId: profile?.brand_id,
        onProgress: (pct) => setUploadProgress(pct),
      })
      setUploadProgress(null)
      clearSelection()
      navigate(`/seller/status/${receipt.id}`)
    } catch {
      setUploadProgress(null)
      // Error toast is dispatched inside the hook
    }
  }

  // Resolved progress: prefer real-time callback value, fall back to hook state.
  const displayProgress = uploadProgress ?? progress

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
        ) : preview ? (
          <div>
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
            <p style={{ fontSize: 13, color: 'var(--vliq-hint)', marginTop: 10, fontWeight: 500 }}>
              {selectedFile?.name ?? 'Файл выбран'}
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

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFileChange} />
      <input ref={fileRef}   type="file" accept="image/*,application/pdf"       hidden onChange={handleFileChange} />

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
          <Btn loading={isPending} disabled={isPending || (!selectedFile && !scannedQr)} onClick={() => void handleSend()}>
            {selectedFile || scannedQr ? 'Отправить чек' : 'Выберите файл'}
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
