/**
 * Safe money / number formatters.
 *
 * All accept `undefined | null | NaN` and return the `fallback` (default "—").
 * This is the single place to keep the formatting contract — never call
 * `Intl.NumberFormat.format(n)` with an untrusted value inline; route it here.
 */

const RU = new Intl.NumberFormat('ru-RU')
// Money is stored in KOPECKS across the whole system (total_sum, bonus_amount,
// balance, payouts), so display divides by 100 and shows up to 2 decimals.
const RU_MONEY = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function isMoney(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Kopecks → "1 646,48 ₽" (whole sums as "250 ₽"). Input is an integer in KOPECKS. */
export function fmtMoney(value: number | null | undefined, fallback = '—'): string {
  if (!isMoney(value)) return fallback
  return `${RU_MONEY.format(value / 100)} ₽`
}

/** Kopecks → "+250 ₽" / "−1 646,48 ₽". Input is an integer in KOPECKS. */
export function fmtMoneyDelta(value: number | null | undefined, fallback = '—'): string {
  if (!isMoney(value)) return fallback
  const sign = value >= 0 ? '+' : '−'
  return `${sign}${RU_MONEY.format(Math.abs(value) / 100)} ₽`
}

/** Plain integer formatting with thousands separator. */
export function fmtInt(value: number | null | undefined, fallback = '—'): string {
  if (!isMoney(value)) return fallback
  return RU.format(Math.trunc(value))
}

/** "42 из 50" or fallback. */
export function fmtRatio(
  part: number | null | undefined,
  whole: number | null | undefined,
  fallback = '—',
): string {
  if (!isMoney(part) || !isMoney(whole)) return fallback
  return `${RU.format(part)} из ${RU.format(whole)}`
}

/** Russian plural by count: e.g. `plural(n, ['чек','чека','чеков'])`. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const mod10  = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1]
  return forms[2]
}

// Back-compat re-exports — kept so existing imports don't break.
export const formatMoney = fmtMoney
export const formatMoneyDelta = fmtMoneyDelta
