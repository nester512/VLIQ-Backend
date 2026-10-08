import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/atoms/Icon'
import { Btn } from '@/components/atoms/Btn'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { useUiStore } from '@/store/uiStore'
import { useHaptic } from '@/hooks/useHaptic'
import { extractApiError } from '@/api/client'
import { getMe } from '@/api/sellers'
import type { ReceiptSource } from '@/api/receipts'
import { fmtMoney } from '@/utils/formatMoney'
import { useSubmitQrReceipt } from '../hooks/useSubmitQrReceipt'
import {
  fiscalKey,
  isTooOld,
  parseQr,
  purchaseDateMsk,
  tFromInputs,
  validateFields,
  type FiscalData,
  type FiscalField,
} from '../qr/fiscalQr'
import { hasCameraScanner, hasTelegramScanner, openTelegramScanner } from '../qr/scanners'
import { wasSentFromThisDevice } from '../qr/sentReceipts'
import { CameraScanner } from '../qr/CameraScanner'

/**
 * «Добавить чек» — QR intake (docs/design/QR-INTAKE.md).
 *
 * The device produces the fiscal data (scan or manual entry), validates it and
 * shows it back for confirmation; only then ONE small JSON request is sent. A
 * non-receipt QR, a refund, a typo — all stop here, never at the API. The seller
 * confirms the data and is responsible for it.
 */

type Step = 'start' | 'manual' | 'confirm'

interface Captured {
  data: FiscalData
  source: ReceiptSource
  rawQr?: string
}

interface ManualValues {
  date: string
  time: string
  sum: string
  fn: string
  fd: string
  fp: string
}

const EMPTY_MANUAL: ManualValues = { date: '', time: '', sum: '', fn: '', fd: '', fp: '' }

const SOURCE_LABEL: Record<ReceiptSource, string> = {
  telegram_scan: 'Сканер Telegram',
  camera_scan: 'Камера',
  image_decode: 'Фото',
  pdf_decode: 'PDF',
  manual: 'Ручной ввод',
}

/** Server/validator field → manual-form field. */
const FIELD_TO_INPUT: Partial<Record<FiscalField, keyof ManualValues>> = {
  fn: 'fn', fd: 'fd', fp: 'fp', s: 'sum', t: 'date',
}

const pad = (n: number) => String(n).padStart(2, '0')

function manualFromData(d: FiscalData): ManualValues {
  const msk = new Date(d.purchaseAt.getTime() + 3 * 3600_000)
  return {
    date: purchaseDateMsk(d),
    time: `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}`,
    sum: (d.totalKop / 100).toFixed(2),
    fn: d.fn,
    fd: d.fd,
    fp: d.fp,
  }
}

function formatPurchase(d: FiscalData): string {
  const msk = new Date(d.purchaseAt.getTime() + 3 * 3600_000)
  return `${pad(msk.getUTCDate())}.${pad(msk.getUTCMonth() + 1)}.${msk.getUTCFullYear()} ${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}`
}

function ActionCard({ icon, title, text, onClick, primary = false }: {
  icon: ReactNode; title: string; text: string; onClick: () => void; primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="vliq-themed vliq-press"
      style={{
        display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', border: 0, cursor: 'pointer',
        padding: primary ? '20px 18px' : '16px 18px', borderRadius: 20, fontFamily: 'inherit',
        background: primary ? 'var(--vliq-brand)' : 'var(--vliq-card)',
        color: primary ? '#fff' : 'var(--vliq-text)',
        boxShadow: primary ? '0 14px 28px -14px var(--vliq-brand)' : 'var(--vliq-shadow-sm)',
      }}
    >
      <div
        style={{
          width: 46, height: 46, borderRadius: 14, display: 'grid', placeItems: 'center', flex: 'none',
          background: primary ? 'rgba(255,255,255,.18)' : 'var(--vliq-field)',
          color: primary ? '#fff' : 'var(--vliq-brand)',
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <b style={{ display: 'block', fontSize: primary ? 17 : 15, fontWeight: 800 }}>{title}</b>
        <span style={{ fontSize: 12.5, fontWeight: 500, opacity: primary ? 0.85 : 1, color: primary ? '#fff' : 'var(--vliq-hint)' }}>
          {text}
        </span>
      </div>
    </button>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--vliq-text)', marginBottom: 6 }}>{label}</span>
      {children}
      {error ? (
        <span role="alert" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-dg)', marginTop: 5 }}>{error}</span>
      ) : hint ? (
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--vliq-hint)', marginTop: 5 }}>{hint}</span>
      ) : null}
    </label>
  )
}

const inputStyle = (invalid: boolean) => ({
  width: '100%', padding: '12px 14px', borderRadius: 14, fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--vliq-field)', color: 'var(--vliq-text)', outline: 'none',
  border: invalid ? '1.5px solid var(--color-dg)' : '1.5px solid transparent',
})

function ManualForm({ initial, serverErrors, onDone, onCancel }: {
  initial: ManualValues
  serverErrors: Partial<Record<keyof ManualValues, string>>
  onDone: (data: FiscalData) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(initial)
  const [errors, setErrors] = useState<Partial<Record<keyof ManualValues, string>>>(serverErrors)
  const set = (k: keyof ManualValues) => (e: { target: { value: string } }) => {
    setV((prev) => ({ ...prev, [k]: e.target.value }))
    setErrors((prev) => ({ ...prev, [k]: undefined }))
  }

  function submit() {
    const missing: Partial<Record<keyof ManualValues, string>> = {}
    for (const k of Object.keys(EMPTY_MANUAL) as Array<keyof ManualValues>) {
      if (!v[k].trim()) missing[k] = 'Заполните поле'
    }
    if (Object.keys(missing).length) {
      setErrors(missing)
      return
    }
    const r = validateFields({ fn: v.fn, fd: v.fd, fp: v.fp, t: tFromInputs(v.date, v.time), s: v.sum, n: 1 })
    if (!r.ok) {
      setErrors({ [FIELD_TO_INPUT[r.error.field] ?? 'fn']: r.error.message })
      return
    }
    onDone(r.data)
  }

  return (
    <div className="vliq-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <b style={{ fontSize: 16, fontWeight: 800, color: 'var(--vliq-text)' }}>Данные с чека</b>
        <p style={{ fontSize: 12.5, color: 'var(--vliq-hint)', marginTop: 4 }}>
          Всё есть внизу бумажного чека: дата и время, «ИТОГ», ФН, ФД и ФП (ФПД).
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Дата" error={errors.date}>
          <input type="date" aria-label="Дата" value={v.date} onChange={set('date')} style={inputStyle(Boolean(errors.date))} />
        </Field>
        <Field label="Время" error={errors.time}>
          <input type="time" aria-label="Время" value={v.time} onChange={set('time')} style={inputStyle(Boolean(errors.time))} />
        </Field>
      </div>
      <Field label="Сумма (ИТОГ), ₽" error={errors.sum}>
        <input inputMode="decimal" aria-label="Сумма" placeholder="1450.00" value={v.sum} onChange={set('sum')} style={inputStyle(Boolean(errors.sum))} />
      </Field>
      <Field label="ФН" hint="16 цифр" error={errors.fn}>
        <input inputMode="numeric" aria-label="ФН" placeholder="9960440300712345" value={v.fn} onChange={set('fn')} style={inputStyle(Boolean(errors.fn))} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="ФД" hint="№ документа" error={errors.fd}>
          <input inputMode="numeric" aria-label="ФД" value={v.fd} onChange={set('fd')} style={inputStyle(Boolean(errors.fd))} />
        </Field>
        <Field label="ФП / ФПД" hint="до 10 цифр" error={errors.fp}>
          <input inputMode="numeric" aria-label="ФП" value={v.fp} onChange={set('fp')} style={inputStyle(Boolean(errors.fp))} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Btn variant="ghost" onClick={onCancel}>Назад</Btn>
        <Btn onClick={submit}>Проверить</Btn>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--vliq-sep)' }}>
      <span style={{ fontSize: 13, color: 'var(--vliq-hint)' }}>{label}</span>
      <b style={{ fontSize: 14, fontWeight: 700, color: 'var(--vliq-text)', textAlign: 'right', wordBreak: 'break-all' }}>{value}</b>
    </div>
  )
}

function UploadContent() {
  const navigate = useNavigate()
  const pushToast = useUiStore((s) => s.pushToast)
  const { notification } = useHaptic()
  const { mutateAsync: submit, isPending } = useSubmitQrReceipt()
  const { data: profile } = useQuery({ queryKey: ['sellers', 'me'], queryFn: getMe, staleTime: 60_000 })

  const [step, setStep] = useState<Step>('start')
  const [captured, setCaptured] = useState<Captured | null>(null)
  const [manualInitial, setManualInitial] = useState<ManualValues>(EMPTY_MANUAL)
  const [serverErrors, setServerErrors] = useState<Partial<Record<keyof ManualValues, string>>>({})
  const [scanHint, setScanHint] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Scanners report the same QR many times per second: react once per distinct code.
  const lastRejectedRef = useRef<string | null>(null)
  const telegramScanner = hasTelegramScanner()
  const cameraScanner = hasCameraScanner()

  function accept(data: FiscalData, source: ReceiptSource, rawQr?: string) {
    notification('success')
    setCaptured({ data, source, rawQr })
    setConfirmed(false)
    setError(null)
    setScanHint(null)
    setStep('confirm')
  }

  /** Shared decision for both scanners: accept only a valid sales receipt QR. */
  function handleScan(raw: string, source: ReceiptSource): boolean {
    const r = parseQr(raw)
    if (r.ok) {
      accept(r.data, source, raw)
      return true
    }
    if (lastRejectedRef.current !== raw) {
      lastRejectedRef.current = raw
      notification('error')
      setScanHint(r.error.message)
    }
    return false
  }

  function scan() {
    setError(null)
    if (telegramScanner) {
      openTelegramScanner('Наведите камеру на QR-код чека', (raw) => handleScan(raw, 'telegram_scan'))
    } else if (cameraScanner) {
      setCameraOpen(true)
    }
  }

  async function send() {
    if (!captured || !confirmed) return
    setError(null)
    try {
      const res = await submit({ ...captured, brandId: profile?.brand_id })
      navigate(`/seller/status/${res.id}`)
    } catch (err) {
      const e = extractApiError(err)
      const fieldErrors: Partial<Record<keyof ManualValues, string>> = {}
      for (const [field, message] of Object.entries(e.fieldErrors ?? {})) {
        const input = FIELD_TO_INPUT[field as FiscalField]
        if (input) fieldErrors[input] = message
      }
      if (Object.keys(fieldErrors).length) {
        // The server disagrees with the data: let the seller fix it in the form.
        setServerErrors(fieldErrors)
        setManualInitial(manualFromData(captured.data))
        setStep('manual')
      }
      setError(e.userMessage || 'Не удалось отправить чек. Попробуйте ещё раз.')
      pushToast(e.userMessage || 'Не удалось отправить чек', 'dg')
    }
  }

  const alreadySent = captured ? wasSentFromThisDevice(fiscalKey(captured.data)) : false

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {step === 'start' && (
        <>
          {telegramScanner || cameraScanner ? (
            <ActionCard
              primary
              icon={<Icon name="qr" size={24} />}
              title="Сканировать QR-код"
              text="QR внизу кассового чека — займёт пару секунд"
              onClick={scan}
            />
          ) : (
            <div className="vliq-card" style={{ padding: 16, fontSize: 13, color: 'var(--vliq-hint)' }}>
              Сканер QR доступен в мобильном приложении Telegram. Здесь можно ввести данные чека вручную.
            </div>
          )}
          {scanHint && (
            <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-dg)', margin: '0 4px' }}>
              {scanHint} — отсканируйте QR-код кассового чека.
            </p>
          )}
          <ActionCard
            icon={<Icon name="edit" size={22} />}
            title="Ввести вручную"
            text="Если QR не читается: дата, сумма, ФН, ФД, ФП"
            onClick={() => {
              setServerErrors({})
              setManualInitial(EMPTY_MANUAL)
              setStep('manual')
            }}
          />
          <div className="vliq-card" style={{ padding: 16 }}>
            <b style={{ fontSize: 14, color: 'var(--vliq-text)' }}>Как это работает</b>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--vliq-hint)' }}>
              <li>Сканируете QR или вводите данные чека.</li>
              <li>Проверяете, что всё совпадает с бумажным чеком, и подтверждаете.</li>
              <li>Мы проверяем чек в налоговой (ОФД) и передаём на модерацию.</li>
            </ol>
          </div>
        </>
      )}

      {step === 'manual' && (
        <ManualForm
          key={JSON.stringify(manualInitial) + JSON.stringify(serverErrors)}
          initial={manualInitial}
          serverErrors={serverErrors}
          onDone={(data) => accept(data, 'manual')}
          onCancel={() => setStep(captured ? 'confirm' : 'start')}
        />
      )}

      {step === 'confirm' && captured && (
        <>
          <div className="vliq-card" style={{ padding: '6px 18px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0 6px' }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', background: 'var(--vliq-ok-bg)', color: 'var(--vliq-ok-ink)' }}>
                <Icon name="check" size={20} />
              </div>
              <div>
                <b style={{ fontSize: 16, fontWeight: 800, color: 'var(--vliq-text)' }}>Проверьте данные чека</b>
                <div style={{ fontSize: 12, color: 'var(--vliq-hint)' }}>Источник: {SOURCE_LABEL[captured.source]}</div>
              </div>
            </div>
            <Row label="Дата и время" value={formatPurchase(captured.data)} />
            <Row label="Сумма" value={fmtMoney(captured.data.totalKop)} />
            <Row label="ФН" value={captured.data.fn} />
            <Row label="ФД" value={captured.data.fd} />
            <Row label="ФП" value={captured.data.fp} />
          </div>

          {isTooOld(captured.data) && (
            <div role="status" className="vliq-card" style={{ padding: 14, fontSize: 13, color: 'var(--vliq-wn-ink)', background: 'var(--vliq-wn-bg)' }}>
              Чеку больше 30 дней — по условиям программы он может быть отклонён.
            </div>
          )}
          {alreadySent && (
            <div role="status" className="vliq-card" style={{ padding: 14, fontSize: 13, color: 'var(--vliq-wn-ink)', background: 'var(--vliq-wn-bg)' }}>
              Вы уже отправляли этот чек с этого телефона. Отправляйте повторно, только если вас об этом попросили.
            </div>
          )}

          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '4px 4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ width: 20, height: 20, marginTop: 2, flex: 'none' }}
            />
            <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--vliq-text)' }}>
              Данные совпадают с моим чеком. Я отвечаю за их верность.
            </span>
          </label>

          {error && <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-dg)', margin: '0 4px' }}>{error}</p>}

          <Btn onClick={() => void send()} disabled={!confirmed || isPending} loading={isPending}>
            {alreadySent ? 'Отправить повторно' : 'Отправить на проверку'}
          </Btn>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Btn
              variant="ghost"
              onClick={() => {
                setServerErrors({})
                setManualInitial(manualFromData(captured.data))
                setStep('manual')
              }}
            >
              Исправить
            </Btn>
            <Btn variant="ghost" onClick={() => { setCaptured(null); setStep('start') }}>
              Другой чек
            </Btn>
          </div>
        </>
      )}

      {cameraOpen && (
        <CameraScanner
          hint={scanHint}
          onClose={() => setCameraOpen(false)}
          onScan={(raw) => {
            const ok = handleScan(raw, 'camera_scan')
            if (ok) setCameraOpen(false)
            return ok
          }}
        />
      )}
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
