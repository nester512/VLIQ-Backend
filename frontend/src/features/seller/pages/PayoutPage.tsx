import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { HeroBalance } from '@/components/molecules/HeroBalance'
import { Field } from '@/components/atoms/Field'
import { Btn } from '@/components/atoms/Btn'
import { Icon } from '@/components/atoms/Icon'
import { HeroSkeleton } from '@/components/atoms/Skeleton'
import { useBalance } from '../hooks/useBalance'
import { useRequestPayout } from '../hooks/useRequestPayout'
import { fmtMoney } from '@/utils/formatMoney'

/** Fallback only — the server's minimum (balance.payout_min_amount) wins. */
const DEFAULT_MIN_PAYOUT = 300_000

// S5.3: requisites are entered in THIS form on every request and never stored
// in the profile. The only payout method per spec is СБП by phone number —
// a Russian mobile (the server normalises and re-checks the same rule).
function normalizePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, '')
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1)
  return /^9\d{9}$/.test(d) ? `+7${d}` : null
}

export function PayoutPage() {
  const navigate = useNavigate()
  const { data: balance, isLoading: balanceLoading } = useBalance()
  const { mutateAsync: requestPayout, isPending } = useRequestPayout()
  // One key per filled-in form: a double tap / retry of the SAME values cannot create a
  // second request; changing the amount or phone is a new request → a new key.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const newForm = () => setIdempotencyKey(crypto.randomUUID())

  const available = balance?.available ?? 0
  const MIN_PAYOUT_KOPECKS = balance?.payout_min_amount ?? DEFAULT_MIN_PAYOUT

  // S5.1: partial withdrawal — the amount is editable (default = full balance).
  const [amountStr, setAmountStr] = useState('')
  const [phone, setPhone] = useState('')

  // The seller types rubles; balance/amount are stored in kopecks → ×100.
  const amount = amountStr === '' ? available : Math.round((Number(amountStr) || 0) * 100)
  const amountValid = amount >= MIN_PAYOUT_KOPECKS && amount <= available
  const normalizedPhone = normalizePhone(phone)
  const phoneValid = normalizedPhone !== null
  const notBlocked = true // status gate is enforced server-side
  const canSubmit = amountValid && phoneValid && available > 0

  const amountError = amountStr !== ''
    ? amount < MIN_PAYOUT_KOPECKS
      ? `Минимальная сумма — ${fmtMoney(MIN_PAYOUT_KOPECKS)}`
      : amount > available
        ? 'Больше доступного баланса'
        : undefined
    : undefined

  async function handleRequest() {
    if (!canSubmit || normalizedPhone === null) return
    try {
      await requestPayout({ payload: { amount, method: 'sbp_phone', phone: normalizedPhone }, idempotencyKey })
    } catch {
      return // toast already shown; the same key is reused on retry
    }
    setIdempotencyKey(crypto.randomUUID())
    navigate('/seller/payouts')
  }

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, paddingBottom: 32 }}>
      {balanceLoading ? (
        <div style={{ margin: '0 -16px' }}><HeroSkeleton /></div>
      ) : (
        <HeroBalance available={available} margin="0 0 16px" />
      )}

      {/* S5.1 — partial amount input */}
      <Field
        label="Сумма выплаты, ₽"
        inputMode="numeric"
        value={amountStr}
        placeholder={String(Math.floor(available / 100))}
        error={amountError}
        hint={`Доступно ${fmtMoney(available)} · минимум ${fmtMoney(MIN_PAYOUT_KOPECKS)}`}
        onChange={(e) => { setAmountStr(e.target.value.replace(/[^\d]/g, '')); newForm() }}
      />

      {/* S5.3 — requisites entered per request, not from profile */}
      <div className="vliq-field" style={{ marginTop: 12 }}>
        <label>Способ выплаты</label>
        <div className="vliq-field-v">СБП · по номеру телефона</div>
      </div>
      <Field
        label="Номер телефона для СБП"
        inputMode="tel"
        value={phone}
        placeholder="+7 900 000-00-00"
        error={phone !== '' && !phoneValid ? 'Номер мобильного: +7 9XX XXX-XX-XX' : undefined}
        onChange={(e) => { setPhone(e.target.value); newForm() }}
        className="mt-3"
      />

      {/* Info banner */}
      <div
        style={{
          borderRadius: 14, padding: '13px 15px', display: 'flex', gap: 9,
          alignItems: 'flex-start', margin: '16px 0',
          background: 'var(--vliq-wn-bg)', color: 'var(--vliq-wn-ink)',
          fontSize: 13, fontWeight: 600,
        }}
      >
        <Icon name="clock" size={18} className="flex-none" />
        <span>
          Выплата будет произведена в течение 7 рабочих дней.
        </span>
      </div>

      <Btn loading={isPending} disabled={!canSubmit || !notBlocked} onClick={() => void handleRequest()}>
        {available <= 0 ? 'Нет доступного баланса' : `Запросить ${fmtMoney(amount)}`}
      </Btn>

      <button
        type="button"
        onClick={() => navigate('/seller/payouts')}
        style={{
          display: 'block', width: '100%', marginTop: 12, background: 'transparent',
          border: 0, color: 'var(--vliq-brand)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Мои заявки на выплату →
      </button>
    </div>
  )
}
