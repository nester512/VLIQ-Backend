import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '@/components/atoms/Icon'
import { Btn } from '@/components/atoms/Btn'
import { Spinner } from '@/components/atoms/Spinner'
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
  type FiscalCandidate,
  pickFiscal,
} from '../qr/fiscalQr'
import { hasCameraScanner, hasTelegramScanner, openTelegramScanner } from '../qr/scanners'
import { wasSentFromThisDevice } from '../qr/sentReceipts'
import { CameraScanner } from '../qr/CameraScanner'

/**
 * «Добавить чек» — QR intake (docs/design/RECEIPT-JOURNEY.md).
 *
 * The device produces the fiscal data (scan or manual entry), validates it and
 * shows it back for confirmation; only then ONE small JSON request is sent. A
 * non-receipt QR, a refund, a typo — all stop here, never at the API. The seller
 * confirms the data and is responsible for it.
 */

type Step = 'start' | 'manual' | 'confirm' | 'choose'

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

/** Seconds of a scanned `t` (not editable): kept when «Исправить» leaves date/time as scanned,
 *  so the corrected data still matches the QR the OFD knows. */
interface ManualSeed {
  values: ManualValues
  seconds: string
}

type InputKey = keyof ManualValues
const INPUT_KEYS: InputKey[] = ['date', 'time', 'sum', 'fn', 'fd', 'fp']
const EMPTY_MANUAL: ManualValues = { date: '', time: '', sum: '', fn: '', fd: '', fp: '' }
const EMPTY_SEED: ManualSeed = { values: EMPTY_MANUAL, seconds: '' }

const SOURCE_LABEL: Record<ReceiptSource, string> = {
  telegram_scan: 'Сканер Telegram',
  camera_scan: 'Камера',
  image_decode: 'Фото',
  pdf_decode: 'PDF',
  manual: 'Ручной ввод',
}

/** Server/validator field → manual-form fields it concerns. */
const FIELD_TO_INPUTS: Partial<Record<FiscalField, InputKey[]>> = {
  fn: ['fn'], fd: ['fd'], fp: ['fp'], s: ['sum'], t: ['date', 'time'],
}

function errorsFor(field: FiscalField, message: string): Partial<Record<InputKey, string>> {
  const out: Partial<Record<InputKey, string>> = {}
  for (const key of FIELD_TO_INPUTS[field] ?? ['fn']) out[key] = message
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')

function seedFromData(d: FiscalData): ManualSeed {
  const msk = new Date(d.purchaseAt.getTime() + 3 * 3600_000)
  return {
    values: {
      date: purchaseDateMsk(d),
      time: `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}`,
      sum: (d.totalKop / 100).toFixed(2),
      fn: d.fn,
      fd: d.fd,
      fp: d.fp,
    },
    seconds: d.t.length === 15 ? d.t.slice(13) : '',
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

const inputStyle = (invalid: boolean) => ({
  width: '100%', padding: '12px 14px', borderRadius: 14, fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
  background: 'var(--vliq-field)', color: 'var(--vliq-text)', outline: 'none',
  border: invalid ? '1.5px solid var(--color-dg)' : '1.5px solid transparent',
})

interface FieldProps {
  id: InputKey
  label: string
  hint?: string
  error?: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'time'
  inputMode?: 'numeric' | 'decimal'
  placeholder?: string
}

/** Labelled input; the hint/error is linked via aria-describedby and marks aria-invalid. */
function Field({ id, label, hint, error, value, onChange, type = 'text', inputMode, placeholder }: FieldProps) {
  const inputId = `qr-${id}`
  const noteId = `${inputId}-note`
  return (
    <div>
      <label htmlFor={inputId} style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--vliq-text)', marginBottom: 6 }}>
        {label}
      </label>
      <input
        id={inputId}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? noteId : undefined}
        style={inputStyle(Boolean(error))}
      />
      {error ? (
        <span id={noteId} role="alert" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--color-dg)', marginTop: 5 }}>{error}</span>
      ) : hint ? (
        <span id={noteId} style={{ display: 'block', fontSize: 11.5, color: 'var(--vliq-hint)', marginTop: 5 }}>{hint}</span>
      ) : null}
    </div>
  )
}

function ManualForm({ seed, serverErrors, onDone, onCancel }: {
  seed: ManualSeed
  serverErrors: Partial<Record<InputKey, string>>
  onDone: (data: FiscalData) => void
  onCancel: () => void
}) {
  const [v, setV] = useState(seed.values)
  const [errors, setErrors] = useState<Partial<Record<InputKey, string>>>(serverErrors)
  const set = (k: InputKey) => (value: string) => {
    setV((prev) => ({ ...prev, [k]: value }))
    setErrors((prev) => ({ ...prev, [k]: undefined }))
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const missing: Partial<Record<InputKey, string>> = {}
    for (const k of INPUT_KEYS) if (!v[k].trim()) missing[k] = 'Заполните поле'
    if (Object.keys(missing).length) {
      setErrors(missing)
      return
    }
    const sameMoment = v.date === seed.values.date && v.time === seed.values.time
    const r = validateFields({ fn: v.fn, fd: v.fd, fp: v.fp, t: tFromInputs(v.date, v.time, sameMoment ? seed.seconds : ''), s: v.sum, n: 1 })
    if (!r.ok) {
      setErrors(errorsFor(r.error.field, r.error.message))
      return
    }
    onDone(r.data)
  }

  return (
    <form onSubmit={submit} noValidate className="vliq-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <b style={{ fontSize: 16, fontWeight: 800, color: 'var(--vliq-text)' }}>Данные с чека</b>
        <p style={{ fontSize: 12.5, color: 'var(--vliq-hint)', marginTop: 4 }}>
          Всё есть внизу бумажного чека: дата и время, «ИТОГ», ФН, ФД и ФП (ФПД).
        </p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
        <Field id="date" label="Дата" type="date" value={v.date} onChange={set('date')} error={errors.date} />
        <Field id="time" label="Время" type="time" value={v.time} onChange={set('time')} error={errors.time} />
      </div>
      <Field id="sum" label="Сумма (ИТОГ), ₽" inputMode="decimal" placeholder="1450.00" value={v.sum} onChange={set('sum')} error={errors.sum} />
      <Field id="fn" label="ФН" hint="16 цифр" inputMode="numeric" placeholder="9960440300712345" value={v.fn} onChange={set('fn')} error={errors.fn} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
        <Field id="fd" label="ФД" hint="№ документа" inputMode="numeric" value={v.fd} onChange={set('fd')} error={errors.fd} />
        <Field id="fp" label="ФП" hint="ФП / ФПД, до 10 цифр" inputMode="numeric" value={v.fp} onChange={set('fp')} error={errors.fp} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
        <Btn type="button" variant="ghost" onClick={onCancel}>Назад</Btn>
        <Btn type="submit">Проверить</Btn>
      </div>
    </form>
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
  const [manualSeed, setManualSeed] = useState<ManualSeed>(EMPTY_SEED)
  const [serverErrors, setServerErrors] = useState<Partial<Record<InputKey, string>>>({})
  // A second fast tap lands before `isPending` re-renders the button disabled.
  const sendingRef = useRef(false)
  const [scanHint, setScanHint] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Scanners report the same QR many times per second: react once per distinct code.
  const lastRejectedRef = useRef<string | null>(null)
  const telegramScanner = hasTelegramScanner()
  const cameraScanner = hasCameraScanner()
  const fileRef = useRef<HTMLInputElement>(null)
  const [decoding, setDecoding] = useState(false)
  const [fileHint, setFileHint] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Array<FiscalCandidate & { source: ReceiptSource }>>([])
  // Each decode gets a token: a result that arrives after a newer decode started or
  // after the page unmounted is dropped instead of yanking the seller to another step.
  const decodeIdRef = useRef(0)
  useEffect(() => () => { decodeIdRef.current = -1 }, [])

  /** Photo / screenshot / PDF → QR text ON THE DEVICE → the same validation as a scan. */
  async function decodeFile(file: File) {
    const id = ++decodeIdRef.current
    const current = () => decodeIdRef.current === id
    setError(null)
    setScanHint(null)
    setFileHint(null)
    setDecoding(true)
    try {
      const { decodeImageFile, decodePdfFile, isPdf, looksLikeImage, MAX_FILE_BYTES, PdfDecodeError, PDF_PROBLEM_MESSAGE } =
        await import('../qr/decode')
      const pdf = isPdf(file)
      if (!pdf && !looksLikeImage(file)) {
        if (current()) setFileHint('Подойдёт фото, скриншот или PDF чека')
        return
      }
      if (file.size > MAX_FILE_BYTES) {
        if (current()) setFileHint('Файл слишком большой — сделайте скриншот чека или снимите ближе')
        return
      }
      const source: ReceiptSource = pdf ? 'pdf_decode' : 'image_decode'
      let texts: string[]
      try {
        texts = pdf ? await decodePdfFile(file) : await decodeImageFile(file)
      } catch (err) {
        if (!(err instanceof PdfDecodeError)) throw err
        if (current()) {
          notification('error')
          setFileHint(PDF_PROBLEM_MESSAGE[err.reason]) // say WHY the PDF gave nothing
        }
        return
      }
      if (!current()) return
      const picked = pickFiscal(texts)
      if (picked.kind === 'one') {
        accept(picked.candidate.data, source, picked.candidate.raw)
      } else if (picked.kind === 'many') {
        setCandidates(picked.candidates.map((c) => ({ ...c, source })))
        setStep('choose')
      } else {
        notification('error')
        // A PDF has no «снимите ближе»: tell the seller what to do with a PDF.
        setFileHint(pdf && texts.length === 0 ? PDF_PROBLEM_MESSAGE.pdf_no_qr : picked.message)
      }
    } catch {
      if (!current()) return
      notification('error')
      setFileHint('Не удалось прочитать файл. Попробуйте другое фото или введите данные вручную.')
    } finally {
      if (current()) setDecoding(false)
    }
  }

  function accept(data: FiscalData, source: ReceiptSource, rawQr?: string) {
    notification('success')
    setCaptured({ data, source, rawQr })
    setConfirmed(false)
    setError(null)
    setScanHint(null)
    setFileHint(null)
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
    if (decoding) return
    setError(null)
    setScanHint(null)
    setFileHint(null)
    lastRejectedRef.current = null
    if (telegramScanner && openTelegramScanner('Наведите камеру на QR-код чека', (raw) => handleScan(raw, 'telegram_scan'))) {
      return
    }
    if (cameraScanner) {
      setCameraOpen(true)
    } else {
      setScanHint('Сканер недоступен на этом устройстве')
    }
  }

  async function send() {
    if (!captured || !confirmed || sendingRef.current) return
    sendingRef.current = true
    setError(null)
    try {
      const res = await submit({ ...captured, brandId: profile?.brand_id })
      navigate(`/seller/status/${res.id}`)
    } catch (err) {
      const e = extractApiError(err)
      let fieldErrors: Partial<Record<InputKey, string>> = {}
      for (const [field, message] of Object.entries(e.fieldErrors ?? {})) {
        if (FIELD_TO_INPUTS[field as FiscalField]) fieldErrors = { ...fieldErrors, ...errorsFor(field as FiscalField, message) }
      }
      if (Object.keys(fieldErrors).length) {
        // The server disagrees with the data: let the seller fix it in the form.
        setServerErrors(fieldErrors)
        setManualSeed(seedFromData(captured.data))
        setStep('manual')
      }
      setError(e.userMessage || 'Не удалось отправить чек. Попробуйте ещё раз.')
      pushToast(e.userMessage || 'Не удалось отправить чек', 'dg')
    } finally {
      sendingRef.current = false
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
            icon={decoding ? <Spinner size={22} /> : <Icon name="file" size={22} />}
            title={decoding ? 'Ищем QR-код…' : 'Фото или PDF чека'}
            text="Скриншот, фото из галереи или электронный чек — QR распознаётся на телефоне"
            onClick={() => { if (!decoding) fileRef.current?.click() }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            aria-label="Выбрать фото или PDF чека"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = '' // the same file can be picked again
              if (file) void decodeFile(file)
            }}
          />
          {fileHint && (
            <p role="alert" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-dg)', margin: '0 4px' }}>
              {fileHint}
            </p>
          )}
          <ActionCard
            icon={<Icon name="edit" size={22} />}
            title="Ввести вручную"
            text="Если QR не читается: дата, сумма, ФН, ФД, ФП"
            onClick={() => {
              if (decoding) return
              setFileHint(null)
              setServerErrors({})
              setManualSeed(EMPTY_SEED)
              setStep('manual')
            }}
          />
          <div className="vliq-card" style={{ padding: 16 }}>
            <b style={{ fontSize: 14, color: 'var(--vliq-text)' }}>Как это работает</b>
            <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--vliq-hint)' }}>
              <li>Сканируете QR, выбираете фото/PDF чека или вводите данные — всё распознаётся на телефоне.</li>
              <li>Проверяете, что всё совпадает с бумажным чеком, и подтверждаете.</li>
              <li>Мы проверяем чек в налоговой (ОФД) и передаём на модерацию.</li>
            </ol>
          </div>
        </>
      )}

      {step === 'choose' && (
        <div className="vliq-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <b style={{ fontSize: 16, fontWeight: 800, color: 'var(--vliq-text)' }}>На снимке несколько чеков</b>
          <p style={{ fontSize: 12.5, color: 'var(--vliq-hint)', margin: 0 }}>
            Выберите один — каждый чек отправляется отдельно.
          </p>
          {candidates.map((c) => (
            <button
              key={fiscalKey(c.data)}
              type="button"
              onClick={() => accept(c.data, c.source, c.raw)}
              className="vliq-row"
              style={{ textAlign: 'left' }}
            >
              <div className="vliq-row-tx">
                <b>{fmtMoney(c.data.totalKop)}</b>
                <span>{formatPurchase(c.data)} · ФД {c.data.fd}</span>
              </div>
            </button>
          ))}
          <Btn variant="ghost" onClick={() => setStep('start')}>Назад</Btn>
        </div>
      )}

      {step === 'manual' && (
        <ManualForm
          key={JSON.stringify(manualSeed) + JSON.stringify(serverErrors)}
          seed={manualSeed}
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
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 10 }}>
            {/* Locked while sending: a late response must not remount a form being edited. */}
            <Btn
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                setServerErrors({})
                setManualSeed(seedFromData(captured.data))
                setStep('manual')
              }}
            >
              Исправить
            </Btn>
            <Btn variant="ghost" disabled={isPending} onClick={() => { setCaptured(null); setStep('start') }}>
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
