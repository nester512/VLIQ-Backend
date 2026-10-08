/**
 * Fiscal receipt QR (ФНС, ФЗ-54) — parse + strict validation ON THE DEVICE, so a
 * wrong scan or a typo never becomes a request. Mirror of the server validator
 * `backend/src/receipt_intake/fiscal.py`; both test suites run the same case table
 * (`fiscalQr.test.ts` ↔ `tests/receipt_intake/test_fiscal.py`) — keep them identical.
 *
 * QR: `t=YYYYMMDDTHHMM[SS]&s=<руб>[.коп]&fn=<ФН>&i=<ФД>&fp=<ФП>&n=<тип>`.
 */

export type FiscalField = 'qr' | 'fn' | 'fd' | 'fp' | 't' | 's' | 'n'

export interface FiscalData {
  fn: string
  fd: string
  fp: string
  /** As in the QR: YYYYMMDDTHHMM or YYYYMMDDTHHMMSS (shop local time, read as MSK). */
  t: string
  totalKop: number
  operationType: number
  /** Purchase moment (UTC), for display and the age check. */
  purchaseAt: Date
}

export interface FiscalError {
  code: string
  field: FiscalField
  message: string
}

export type FiscalResult = { ok: true; data: FiscalData } | { ok: false; error: FiscalError }

const FN_RE = /^\d{16}$/
const ID_RE = /^\d{1,10}$/
const T_RE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/
const S_RE = /^\d{1,9}([.,]\d{1,2})?$/

export const OPERATION_INCOME = 1
export const MAX_AGE_DAYS = 30
const FUTURE_TOLERANCE_MS = 14 * 3600_000
const MSK_OFFSET_MS = 3 * 3600_000

const fail = (code: string, field: FiscalField, message: string): FiscalResult => ({ ok: false, error: { code, field, message } })
const digits = (v: string | number | null | undefined) => String(v ?? '').replace(/\s+/g, '')
/** ФД / ФП as a number: a paper receipt may pad them with zeros — «00012» is «12». */
const asNumber = (v: string | number | null | undefined) => {
  const s = digits(v)
  return s.replace(/^0+/, '') || s
}

export function validateFields(
  input: { fn: string; fd: string; fp: string; t: string; s: string; n?: string | number },
  now: Date = new Date(),
): FiscalResult {
  const fn = digits(input.fn)
  const fd = asNumber(input.fd)
  const fp = asNumber(input.fp)
  if (!FN_RE.test(fn)) return fail('QR_FN_INVALID', 'fn', 'ФН — ровно 16 цифр')
  if (!ID_RE.test(fd) || Number(fd) === 0) return fail('QR_FD_INVALID', 'fd', 'ФД — число до 10 цифр')
  if (!ID_RE.test(fp) || Number(fp) === 0) return fail('QR_FP_INVALID', 'fp', 'ФП — число до 10 цифр')

  const t = String(input.t ?? '').trim()
  const m = T_RE.exec(t)
  if (!m) return fail('QR_DATE_INVALID', 't', 'Дата и время чека в формате ГГГГММДДTЧЧММ')
  const [y, mo, d, h, mi, se] = m.slice(1).map((x) => (x ? Number(x) : 0)) as [number, number, number, number, number, number]
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, se) - MSK_OFFSET_MS
  const check = new Date(utcMs + MSK_OFFSET_MS)
  if (
    mo < 1 || mo > 12 || h > 23 || mi > 59 || se > 59 ||
    check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d
  ) {
    return fail('QR_DATE_INVALID', 't', 'Такой даты не существует')
  }
  if (utcMs - now.getTime() > FUTURE_TOLERANCE_MS) return fail('QR_DATE_IN_FUTURE', 't', 'Дата чека в будущем')

  const s = String(input.s ?? '').trim()
  if (!S_RE.test(s)) return fail('QR_SUM_INVALID', 's', 'Сумма — число с копейками через точку')
  const [rub = '0', kop = ''] = s.replace(',', '.').split('.')
  const totalKop = Number(rub) * 100 + Number((kop + '00').slice(0, 2))
  if (totalKop <= 0) return fail('QR_SUM_INVALID', 's', 'Сумма должна быть больше нуля')

  const nRaw = String(input.n ?? OPERATION_INCOME).trim()
  if (!/^\d+$/.test(nRaw)) return fail('QR_OPERATION_INVALID', 'n', 'Неизвестный тип операции')
  if (Number(nRaw) !== OPERATION_INCOME) return fail('QR_NOT_INCOME', 'n', 'Это не чек продажи (возврат или коррекция)')

  return { ok: true, data: { fn, fd, fp, t, totalKop, operationType: OPERATION_INCOME, purchaseAt: new Date(utcMs) } }
}

export function parseQr(raw: string, now: Date = new Date()): FiscalResult {
  let text = (raw ?? '').trim()
  if (/^https?:\/\//i.test(text) && text.includes('?')) text = text.slice(text.indexOf('?') + 1)
  const params = new URLSearchParams(text)
  const get = (k: string) => params.get(k) ?? undefined
  if (['t', 's', 'fn', 'i', 'fp'].some((k) => !get(k))) {
    return fail('QR_NOT_FISCAL', 'qr', 'Это не QR-код кассового чека')
  }
  return validateFields({ fn: get('fn')!, fd: get('i')!, fp: get('fp')!, t: get('t')!, s: get('s')!, n: get('n') ?? '1' }, now)
}

export const sumRub = (kop: number) => `${Math.floor(kop / 100)}.${String(kop % 100).padStart(2, '0')}`

/** Canonical QR string — the same one the server stores as `qr_raw`. */
export const canonicalQr = (d: FiscalData) =>
  `t=${d.t}&s=${sumRub(d.totalKop)}&fn=${d.fn}&i=${d.fd}&fp=${d.fp}&n=${d.operationType}`

export const fiscalKey = (d: FiscalData) => `${d.fn}:${d.fd}:${d.fp}`

/** Calendar date of the purchase in Moscow time, `YYYY-MM-DD`. */
export const purchaseDateMsk = (d: FiscalData) => new Date(d.purchaseAt.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10)

export const isTooOld = (d: FiscalData, now: Date = new Date()) =>
  now.getTime() - d.purchaseAt.getTime() > MAX_AGE_DAYS * 86_400_000

/** Build `t` from manual-entry inputs: date `YYYY-MM-DD` + time `HH:MM` (+ optional seconds `SS`). */
export const tFromInputs = (date: string, time: string, seconds = '') =>
  `${date.replace(/-/g, '')}T${time.replace(':', '').slice(0, 4)}${/^\d{2}$/.test(seconds) ? seconds : ''}`
