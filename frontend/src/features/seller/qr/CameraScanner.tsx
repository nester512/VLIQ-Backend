import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/atoms/Icon'
import { createQrDetector } from './scanners'

interface CameraScannerProps {
  /** Decide on each decoded QR: `true` accepts it (the scanner closes), `false` keeps scanning. */
  onScan: (raw: string) => boolean
  onClose: () => void
  /** Short status line under the viewfinder (e.g. why the last QR was not accepted). */
  hint?: string | null
}

const SCAN_INTERVAL_MS = 250

/** Full-screen rear-camera QR scanner — the in-app fallback to Telegram's scanner. */
export function CameraScanner({ onScan, onClose, hint }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const onScanRef = useRef(onScan)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let stopped = false
    const detector = createQrDetector()

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch {
        setError('Нет доступа к камере. Разрешите доступ или введите данные вручную.')
        return
      }
      if (stopped) return
      const video = videoRef.current
      if (!video || !detector) return
      video.srcObject = stream
      await video.play().catch(() => undefined)
      timer = setInterval(async () => {
        if (stopped || video.readyState < 2) return
        try {
          const codes = await detector.detect(video)
          for (const code of codes) {
            if (onScanRef.current(code.rawValue)) {
              stopped = true
              return
            }
          }
        } catch {
          /* a frame that fails to decode is normal — keep scanning */
        }
      }, SCAN_INTERVAL_MS)
    }

    void start()
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div
      role="dialog"
      aria-label="Сканирование QR-кода"
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: '#000', display: 'flex', flexDirection: 'column' }}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ flex: 1, width: '100%', objectFit: 'cover', minHeight: 0 }}
      />
      <div
        aria-hidden
        style={{
          position: 'absolute', top: '50%', left: '50%', width: 240, height: 240,
          transform: 'translate(-50%, -60%)', border: '3px solid rgba(255,255,255,.9)', borderRadius: 24,
          boxShadow: '0 0 0 100vmax rgba(0,0,0,.45)',
        }}
      />
      <div style={{ position: 'absolute', left: 16, right: 16, bottom: 32, textAlign: 'center', color: '#fff' }}>
        <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Наведите камеру на QR-код чека</p>
        {(error ?? hint) && (
          <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: error ? '#ffb4b4' : '#ffe08a', marginBottom: 12 }}>
            {error ?? hint}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 14, border: 0,
            background: 'rgba(255,255,255,.18)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
          }}
        >
          <Icon name="x" size={18} /> Закрыть
        </button>
      </div>
    </div>
  )
}
