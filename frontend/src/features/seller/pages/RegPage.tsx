import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Field } from '@/components/atoms/Field'
import { Btn } from '@/components/atoms/Btn'
import { useUiStore } from '@/store/uiStore'
import { updateMe } from '@/api/sellers'
import { getTgWebApp, isTmaEnvironment } from '@/utils/tma'
import { extractApiError } from '@/api/client'
import { CitySelect } from '@/components/molecules/CitySelect'
import { useCities } from '@/features/seller/hooks/useCities'

type Step = 1 | 2

const REGISTRATION_DRAFT_KEY = 'vliq.registration.draft'

// S2.2: the анкета has NO payout requisites — they are entered per-request in
// the payout form (S5) and never stored on the profile.
interface FormState {
  first_name: string
  last_name: string
  phone: string
  city: string
  store_name: string
  store_address: string
  store_count: string
  position: string
}

const INITIAL: FormState = {
  first_name: '',
  last_name: '',
  phone: '',
  city: '',
  store_name: '',
  store_address: '',
  store_count: '',
  position: '',
}

interface RegistrationDraft {
  step: Step
  form: FormState
  agreed: boolean
  offerOneAgreed: boolean
  offerTwoAgreed: boolean
}

function readRegistrationDraft(): RegistrationDraft | null {
  try {
    const raw = window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<RegistrationDraft>
    if ((value.step !== 1 && value.step !== 2) || !value.form) return null
    return {
      step: value.step,
      form: { ...INITIAL, ...value.form },
      agreed: Boolean(value.agreed),
      offerOneAgreed: Boolean(value.offerOneAgreed),
      offerTwoAgreed: Boolean(value.offerTwoAgreed),
    }
  } catch {
    return null
  }
}

function clearRegistrationDraft() {
  window.sessionStorage.removeItem(REGISTRATION_DRAFT_KEY)
}

interface ConsentRowProps {
  checked: boolean
  error?: string
  children: ReactNode
  onChange: () => void
}

function ConsentRow({ checked, error, children, onChange }: ConsentRowProps) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onChange}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange()
        }
      }}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start',
        cursor: 'pointer', width: '100%',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22, height: 22, borderRadius: 7, flex: 'none',
          display: 'grid', placeItems: 'center', marginTop: 1,
          background: checked ? 'var(--vliq-brand)' : 'transparent',
          color: '#fff',
          boxShadow: checked
            ? 'inset 0 0 0 1.5px var(--vliq-brand)'
            : `inset 0 0 0 1.5px ${error ? 'var(--color-dg)' : 'var(--vliq-hint)'}`,
          transition: 'background-color .15s',
        }}
      >
        {checked && (
          <svg viewBox="0 0 24 24" width={14} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 10 17.5 19.5 7" />
          </svg>
        )}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--vliq-text)', lineHeight: 1.4 }}>
        {children}
        {error && (
          <span style={{ display: 'block', marginTop: 4, color: 'var(--color-dg)', fontWeight: 600, fontSize: 12 }}>
            {error}
          </span>
        )}
      </span>
    </div>
  )
}

// Phone format: E.164 ("+71234567890"). Loosely validated to surface obvious typos.
const PHONE_RE = /^\+[1-9]\d{7,14}$/

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

  // Opening a local legal-document placeholder unmounts this page. Keep the
  // draft only for this browser tab, never in the API/DB, then clear it after
  // successful registration.
  const [draft] = useState(readRegistrationDraft)
  const [step, setStep] = useState<Step>(() => draft?.step ?? 1)
  const [form, setForm] = useState<FormState>(() => {
    if (draft) return draft.form
    const tg = prefillFromTelegram()
    return {
      ...INITIAL,
      first_name: tg.first_name ?? '',
      last_name:  tg.last_name  ?? '',
      phone:      tg.phone      ?? '',
    }
  })
  const [agreed, setAgreed] = useState(() => draft?.agreed ?? false)
  const [offerOneAgreed, setOfferOneAgreed] = useState(() => draft?.offerOneAgreed ?? false)
  const [offerTwoAgreed, setOfferTwoAgreed] = useState(() => draft?.offerTwoAgreed ?? false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const inTma = isTmaEnvironment()
  const { data: cities = [], isLoading: citiesLoading } = useCities()

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState | 'agreed' | 'offer_one' | 'offer_two', string>> = {}
    if (!form.first_name.trim())        e.first_name = 'Заполните имя'
    if (!form.last_name.trim())         e.last_name  = 'Заполните фамилию'
    if (!PHONE_RE.test(form.phone))     e.phone      = 'Формат: +7XXXXXXXXXX'
    if (!form.city.trim())              e.city       = 'Укажите город'
    else if (!cities.some((c) => c.name === form.city)) e.city = 'Выберите город из списка'
    if (step === 2) {
      if (!form.store_name.trim())      e.store_name = 'Название точки'
      const outletCount = Number(form.store_count)
      if (!form.store_count)             e.store_count = 'Укажите количество точек'
      else if (!Number.isInteger(outletCount) || outletCount < 1 || outletCount > 1000) e.store_count = 'От 1 до 1 000 точек'
      if (!agreed)                      e.agreed     = 'Нужно согласие'
      if (!offerOneAgreed)              e.offer_one  = 'Подтвердите оферту №1'
      if (!offerTwoAgreed)              e.offer_two  = 'Подтвердите оферту №2'
    }
    return e
  }, [form, step, agreed, offerOneAgreed, offerTwoAgreed, cities])

  const step1Valid = !errors.first_name && !errors.last_name && !errors.phone && !errors.city
  const step2Valid = step1Valid && !errors.store_name && !errors.store_count && !errors.agreed && !errors.offer_one && !errors.offer_two

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      updateMe({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        store_name: form.store_name.trim(),
        store_address: form.store_address.trim() || undefined,
        store_count: Number(form.store_count),
        position: form.position.trim() || undefined,
      }),
    onSuccess: async (profile) => {
      clearRegistrationDraft()
      queryClient.setQueryData(['sellers', 'me'], profile)
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

  function saveDraft() {
    const draft: RegistrationDraft = { step: 2, form, agreed, offerOneAgreed, offerTwoAgreed }
    window.sessionStorage.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(draft))
  }

  function submit() {
    setTouched({
      first_name: true, last_name: true, phone: true, city: true,
      store_name: true, store_count: true, agreed: true, offer_one: true, offer_two: true,
    })
    if (!step2Valid) {
      if (errors.agreed || errors.offer_one || errors.offer_two) {
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
        Данные нужны бренду для начисления бонусов. Реквизиты выплаты укажете при заявке.
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
                    background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, color: 'var(--vliq-brand)', lineHeight: 1.2,
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

          <Btn onClick={next} disabled={isPending}>Далее</Btn>
        </>
      ) : (
        <>
          <Field label="Торговая точка" value={form.store_name}    onChange={(e) => update('store_name',    e.target.value)} onBlur={() => setTouched((t) => ({ ...t, store_name: true }))} error={showErr('store_name')} placeholder="Дымов · ТЦ Авиапарк" />
          <Field label="Адрес"           value={form.store_address} onChange={(e) => update('store_address', e.target.value)} placeholder="Адрес точки (необязательно)" />
          <Field label="Количество торговых точек в сети" inputMode="numeric" value={form.store_count} onChange={(e) => update('store_count', e.target.value.replace(/[^\d]/g, ''))} onBlur={() => setTouched((t) => ({ ...t, store_count: true }))} error={showErr('store_count')} hint="От 1 до 1 000" placeholder="1" />
          <Field label="Должность"       value={form.position}      onChange={(e) => update('position',      e.target.value)} placeholder="Продавец-консультант" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6, marginBottom: 16 }}>
            <ConsentRow checked={agreed} error={touched.agreed ? errors.agreed : undefined} onChange={() => { setAgreed((p) => !p); setTouched((t) => ({ ...t, agreed: true })) }}>
              <Link to="/seller/privacy" onClick={(e) => { e.stopPropagation(); saveDraft() }} style={{ color: 'var(--vliq-brand)', fontWeight: 700 }}>Согласие на обработку персональных данных</Link>
            </ConsentRow>
            <ConsentRow checked={offerOneAgreed} error={touched.offer_one ? errors.offer_one : undefined} onChange={() => { setOfferOneAgreed((p) => !p); setTouched((t) => ({ ...t, offer_one: true })) }}>
              Согласие с <Link to="/seller/offer/1" onClick={(e) => { e.stopPropagation(); saveDraft() }} style={{ color: 'var(--vliq-brand)', fontWeight: 700 }}>офертой №1</Link>
            </ConsentRow>
            <ConsentRow checked={offerTwoAgreed} error={touched.offer_two ? errors.offer_two : undefined} onChange={() => { setOfferTwoAgreed((p) => !p); setTouched((t) => ({ ...t, offer_two: true })) }}>
              Согласие с <Link to="/seller/offer/2" onClick={(e) => { e.stopPropagation(); saveDraft() }} style={{ color: 'var(--vliq-brand)', fontWeight: 700 }}>офертой №2</Link>
            </ConsentRow>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={() => setStep(1)} style={{ flex: 'none', width: 'auto', padding: '16px 22px' }}>
              Назад
            </Btn>
            <Btn loading={isPending} disabled={isPending} onClick={submit} style={{ flex: 1 }}>
              Завершить регистрацию
            </Btn>
          </div>
        </>
      )}
    </div>
  )
}
