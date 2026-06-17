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

// S5.3: requisites are entered in THIS form on every request and never stored
// in the profile. The only payout method per spec is СБП by phone number.
function normalizePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, '')
}
function isValidPhone(p: string): boolean {
  const digits = p.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

export function PayoutPage() {
  const navigate = useNavigate()
  const { data: balance, isLoading: balanceLoading } = useBalance()
  const { mutateAsync: requestPayout, isPending } = useRequestPayout()

  const available = balance?.available ?? 0

  // S5.1: partial withdrawal — the amount is editable (default = full balance).
  const [amountStr, setAmountStr] = useState('')
  const [phone, setPhone] = useState('')

  const amount = amountStr === '' ? available : Math.round(Number(amountStr) || 0)
  const amountValid = amount > 0 && amount <= available
  const phoneValid = isValidPhone(phone)
  const notBlocked = true // status gate is enforced server-side
  const canSubmit = amountValid && phoneValid && available > 0

  const amountError =
    amountStr !== '' && amount > available ? 'Больше доступного баланса' : undefined

  async function handleRequest() {
    if (!canSubmit) return
    await requestPayout({ amount, method: 'sbp_phone', details: normalizePhone(phone) })
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
        placeholder={String(available)}
        error={amountError}
        hint={`Доступно ${fmtMoney(available)} · можно вывести часть`}
        onChange={(e) => setAmountStr(e.target.value.replace(/[^\d]/g, ''))}
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
        onChange={(e) => setPhone(e.target.value)}
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
          Заявка обрабатывается после проверки администратором.
          Статусы: Новая → В обработке → Выплачена.
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
