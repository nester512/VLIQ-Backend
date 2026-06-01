import { useRef, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Field } from '@/components/atoms/Field'
import { Btn } from '@/components/atoms/Btn'
import { useUiStore } from '@/store/uiStore'
import { updateMe } from '@/api/sellers'
import type { PayoutMethod } from '@/types/models'
import { getTgWebApp, isTmaEnvironment } from '@/utils/tma'
import { extractApiError } from '@/api/client'
import { CitySelect } from '@/components/molecules/CitySelect'
import { useCities } from '@/features/seller/hooks/useCities'

type Step = 1 | 2

interface FormState {
  first_name: string
  last_name: string
  phone: string
  city: string
  store_name: string
  store_address: string
  position: string
  payout_method: PayoutMethod | ''
  payout_details: string
}

const INITIAL: FormState = {
  first_name: '',
  last_name: '',
  phone: '',
  city: '',
  store_name: '',
  store_address: '',
  position: '',
  payout_method: '',
  payout_details: '',
}

// Phone format: E.164 ("+71234567890"). Loosely validated to surface obvious typos.
const PHONE_RE = /^\+[1-9]\d{7,14}$/
// Card: 16–19 digits (spaces allowed, stripped before testing). Luhn intentionally
// not enforced — the backend stores the raw value + masks last-4, and a naive Luhn
// check rejects some valid cards.
const CARD_RE = /^\d{16,19}$/

// Validate the payout details against the selected method. Returns an error
// string or undefined when valid.
function validatePayoutDetails(method: PayoutMethod | '', raw: string): string | undefined {
  const v = raw.trim()
  if (!v) return 'Заполните реквизиты'
  switch (method) {
    case 'card':
      return CARD_RE.test(v.replace(/\s/g, '')) ? undefined : 'Введите номер карты (16–19 цифр)'
    case 'sbp_phone':
      return PHONE_RE.test(v) ? undefined : 'Формат телефона: +7XXXXXXXXXX'
    case 'sbp_bank':
      return v.length >= 2 ? undefined : 'Укажите название банка / счёт'
    default:
      return undefined
  }
}

function digitsOnlyToE164(s: string): string {
  const digits = s.replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('8') && digits.length === 11) return `+7${digits.slice(1)}`
  if (digits.startsWith('7') && digits.length === 11) return `+${digits}`
  return s.startsWith('+') ? s : `+${digits}`
}

function prefillFromTelegram(): Partial<FormState> {
  const tg = getTgWebApp()
  const u = tg?.initDataUnsafe?.user
  if (!u) return {}
  const phone = u.phone_number
    ? u.phone_number.startsWith('+') ? u.phone_number : `+${u.phone_number}`
    : ''
  return {
    first_name: u.first_name ?? '',
    last_name: u.last_name ?? '',
    ...(phone ? { phone } : {}),
  }
}

export function RegPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)

  const [step, setStep] = useState<Step>(1)
  // Lazy initializer: compute the Telegram-prefilled initial form once at mount
  // time instead of calling setForm inside a useEffect, which would trigger an
  // extra render and violate react-hooks/set-state-in-effect.
  const [form, setForm] = useState<FormState>(() => {
    const tg = prefillFromTelegram()
    return {
      ...INITIAL,
      first_name: tg.first_name ?? '',
      last_name:  tg.last_name  ?? '',
      phone:      tg.phone      ?? '',
    }
  })
  const [agreed, setAgreed] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  // Track whether payout_details was auto-filled from the phone field so we
  // don't overwrite a value the seller typed manually.
  const sbpAutoFilled = useRef(false)
  const inTma = isTmaEnvironment()
  const { data: cities = [], isLoading: citiesLoading } = useCities()

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }

      // Switching payout method invalidates whatever was typed for the old one
      // (e.g. a phone left over from СБП is not a valid card number). Clear it,
      // then re-apply the SBP autofill for the newly selected method.
      if (key === 'payout_method' && value !== prev.payout_method) {
        next.payout_details = ''
        sbpAutoFilled.current = false
        if (value === 'sbp_phone' && PHONE_RE.test(prev.phone)) {
          next.payout_details = prev.phone
          sbpAutoFilled.current = true
        }
      }

      // If the seller edits payout_details directly, clear the auto-fill flag
      // so future phone changes don't clobber their typed value.
      if (key === 'payout_details') {
        sbpAutoFilled.current = false
      }

      return next
    })
  }

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState | 'agreed', string>> = {}
    if (!form.first_name.trim())        e.first_name = 'Заполните имя'
    if (!form.last_name.trim())         e.last_name  = 'Заполните фамилию'
    if (!PHONE_RE.test(form.phone))     e.phone      = 'Формат: +7XXXXXXXXXX'
    if (!form.city.trim())              e.city       = 'Укажите город'
    else if (!cities.some((c) => c.name === form.city)) e.city = 'Выберите город из списка'
    if (step === 2) {
      if (!form.store_name.trim())      e.store_name    = 'Название точки'
      if (!form.payout_method) {
        e.payout_method = 'Выберите способ'
      } else {
        const pd = validatePayoutDetails(form.payout_method, form.payout_details)
        if (pd) e.payout_details = pd
      }
      if (!agreed)                      e.agreed         = 'Нужно согласие'
    }
    return e
  }, [form, step, agreed, cities])

  const step1Valid = !errors.first_name && !errors.last_name && !errors.phone && !errors.city
  const step2Valid = step1Valid && !errors.store_name && !errors.payout_method && !errors.payout_details && !errors.agreed

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      updateMe({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        store_name: form.store_name.trim(),
        store_address: form.store_address.trim() || undefined,
        position: form.position.trim() || undefined,
        payout_method: form.payout_method as PayoutMethod,
        payout_account_raw: form.payout_details.trim(),
        consent_pdn_at: new Date().toISOString(),
      }),
    // Prime the cache with the fresh profile right away so SellerProfileGate
    // doesn't see `status === 'pending'` between mutation success and the next
    // GET — otherwise it bounces us straight back to /seller/reg.
    onSuccess: async (profile) => {
      queryClient.setQueryData(['sellers', 'me'], profile)
      // Belt-and-braces refetch in case the backend mutated more fields than
      // the response contains.
      await queryClient.invalidateQueries({ queryKey: ['sellers', 'me'] })
      pushToast('Регистрация завершена', 'ok')
      navigate('/seller/home', { replace: true })
    },
    onError: (err: unknown) => {
      const apiErr = extractApiError(err)
      pushToast(apiErr.userMessage || 'Не удалось сохранить — проверьте поля', 'dg')
    },
  })

  function handleRequestContact() {
    const tg = getTgWebApp()
    tg?.requestContact?.((shared, payload) => {
      if (shared && payload?.responseUnsafe?.contact?.phone_number) {
        const raw = payload.responseUnsafe.contact.phone_number
        const phone = raw.startsWith('+') ? raw : `+${raw}`
        update('phone', phone)
        setTouched((t) => ({ ...t, phone: true }))
      }
    })
  }

  function next() {
    setTouched((t) => ({ ...t, first_name: true, last_name: true, phone: true, city: true }))
    if (step1Valid) setStep(2)
  }

  function submit() {
    setTouched({
      first_name: true, last_name: true, phone: true, city: true,
      store_name: true, payout_method: true, payout_details: true,
      agreed: true,
    })
    if (!step2Valid) {
      if (errors.agreed) {
        pushToast('Подтвердите согласие на обработку данных', 'wn')
      } else {
        pushToast('Заполните подсвеченные поля', 'wn')
      }
      return
    }
    mutate()
  }

  function showErr(key: keyof FormState): string | undefined {
    return touched[key] ? errors[key] : undefined
  }

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, paddingBottom: 32 }}>
      <h1 style={{ fontSize: 25, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.15, color: 'var(--vliq-text)' }}>
        Расскажите о себе
      </h1>
      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--vliq-hint)', marginTop: 6, marginBottom: 16 }}>
        Данные нужны бренду для начисления и выплаты бонусов
      </p>

      {/* Step indicator */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--vliq-brand)' }} />
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: step === 2 ? 'var(--vliq-brand)' : 'var(--vliq-sep)', transition: 'background-color .2s' }} />
      </div>

      {step === 1 ? (
        <>
          <Field label="Имя"     value={form.first_name} onChange={(e) => update('first_name', e.target.value)} onBlur={() => setTouched((t) => ({ ...t, first_name: true }))} error={showErr('first_name')} placeholder="Алексей" />
          <Field label="Фамилия" value={form.last_name}  onChange={(e) => update('last_name',  e.target.value)} onBlur={() => setTouched((t) => ({ ...t, last_name: true }))}  error={showErr('last_name')}  placeholder="Морозов" />

          {/* Phone */}
          <div className="vliq-field">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <label style={{ marginBottom: 0 }}>Номер телефона</label>
              {inTma && (
                <button
                  type="button"
                  onClick={handleRequestContact}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '2px 0',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--vliq-brand)',
                    lineHeight: 1.2,
                  }}
                >
                  Использовать телефон из Telegram
                </button>
              )}
            </div>
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => update('phone', e.target.value)}
              onBlur={(e) => {
                update('phone', digitsOnlyToE164(e.target.value))
                setTouched((t) => ({ ...t, phone: true }))
              }}
              placeholder="+7 ••• ••• •• ••"
              className="vliq-field-v"
            />
            {touched.phone && errors.phone ? (
              <p style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: 'var(--color-dg)' }}>
                {errors.phone}
              </p>
            ) : (
              <p style={{ marginTop: 4, fontSize: 11.5, fontWeight: 500, color: 'var(--vliq-hint)' }}>
                Формат: +7XXXXXXXXXX
              </p>
            )}
          </div>

          <Field label="Город" error={showErr('city')}>
            <CitySelect
              cities={cities}
              loading={citiesLoading}
              value={form.city}
              onChange={(name) => { update('city', name); setTouched((t) => ({ ...t, city: true })) }}
              onBlur={() => setTouched((t) => ({ ...t, city: true }))}
              invalid={!!showErr('city')}
            />
          </Field>

          <Btn onClick={next} disabled={!step1Valid}>Далее</Btn>
        </>
      ) : (
        <>
          <Field label="Торговая точка" value={form.store_name}    onChange={(e) => update('store_name',    e.target.value)} onBlur={() => setTouched((t) => ({ ...t, store_name: true }))} error={showErr('store_name')} placeholder="Дымов · ТЦ Авиапарк" />
          <Field label="Адрес"           value={form.store_address} onChange={(e) => update('store_address', e.target.value)} placeholder="Адрес точки (необязательно)" />
          <Field label="Должность"       value={form.position}      onChange={(e) => update('position',      e.target.value)} placeholder="Продавец-консультант" />

          {/* Payout method selector */}
          <div className="vliq-field">
            <label>Способ выплаты</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {([
                ['sbp_phone', 'СБП'] as const,
                ['card',      'Карта'] as const,
                ['sbp_bank',  'СБП·банк'] as const,
              ]).map(([m, label]) => {
                const active = form.payout_method === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      const changed = m !== form.payout_method
                      update('payout_method', m)
                      setTouched((t) => ({ ...t, payout_method: true, ...(changed ? { payout_details: false } : {}) }))
                    }}
                    className="vliq-press"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: 0,
                      cursor: 'pointer',
                      fontSize: 13,
                      fontWeight: 700,
                      background: active ? 'var(--vliq-brand)' : 'var(--vliq-card)',
                      color: active ? '#fff' : 'var(--vliq-hint)',
                      boxShadow: active ? '0 6px 14px -8px var(--vliq-brand)' : 'var(--vliq-shadow-sm)',
                      transition: 'background-color .15s',
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {touched.payout_method && errors.payout_method && (
              <p style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: 'var(--color-dg)' }}>{errors.payout_method}</p>
            )}
          </div>

          <Field
            label={form.payout_method === 'card' ? 'Номер карты' : form.payout_method === 'sbp_bank' ? 'СБП · название банка' : 'Номер телефона для СБП'}
            value={form.payout_details}
            onChange={(e) => update('payout_details', e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, payout_details: true }))}
            error={showErr('payout_details')}
            placeholder={form.payout_method === 'card' ? '•••• •••• •••• 0000' : '+7 ••• ••• •• ••'}
          />

          {/* Consent checkbox — proper role + aria-checked, clickable label row */}
          <div
            role="checkbox"
            aria-checked={agreed}
            tabIndex={0}
            aria-describedby="consent-help"
            onClick={() => { setAgreed((p) => !p); setTouched((t) => ({ ...t, agreed: true })) }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                setAgreed((p) => !p)
                setTouched((t) => ({ ...t, agreed: true }))
              }
            }}
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              marginTop: 6,
              marginBottom: 16,
              cursor: 'pointer',
              width: '100%',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: 7,
                flex: 'none',
                display: 'grid',
                placeItems: 'center',
                marginTop: 1,
                background: agreed ? 'var(--vliq-brand)' : 'transparent',
                color: '#fff',
                // Border is visible in both themes — solves the "I don't see
                // the checkbox" complaint on dark theme.
                boxShadow: agreed
                  ? 'inset 0 0 0 1.5px var(--vliq-brand)'
                  : `inset 0 0 0 1.5px ${touched.agreed && errors.agreed ? 'var(--color-dg)' : 'var(--vliq-hint)'}`,
                transition: 'background-color .15s',
              }}
            >
              {agreed && (
                <svg viewBox="0 0 24 24" width={14} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5 10 17.5 19.5 7" />
                </svg>
              )}
            </span>
            <span id="consent-help" style={{ fontSize: 13, fontWeight: 500, color: 'var(--vliq-text)', lineHeight: 1.4 }}>
              Согласие на обработку персональных данных и подтверждение правил участия в программе
              {touched.agreed && errors.agreed && (
                <span style={{ display: 'block', marginTop: 4, color: 'var(--color-dg)', fontWeight: 600, fontSize: 12 }}>
                  Нужно подтвердить, чтобы продолжить
                </span>
              )}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={() => setStep(1)} style={{ flex: 'none', width: 'auto', padding: '16px 22px' }}>
              Назад
            </Btn>
            <Btn loading={isPending} disabled={!step2Valid} onClick={submit} style={{ flex: 1 }}>
              Завершить регистрацию
            </Btn>
          </div>
        </>
      )}
    </div>
  )
}
