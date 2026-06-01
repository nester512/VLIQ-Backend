import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { HeroBalance } from '@/components/molecules/HeroBalance'
import { ChecklistItem } from '@/components/molecules/ChecklistItem'
import { Btn } from '@/components/atoms/Btn'
import { Icon } from '@/components/atoms/Icon'
import { HeroSkeleton } from '@/components/atoms/Skeleton'
import { useBalance } from '../hooks/useBalance'
import { useRequestPayout } from '../hooks/useRequestPayout'
import { getMe } from '@/api/sellers'
import { fmtMoney } from '@/utils/formatMoney'

const MIN_PAYOUT = 1_000

const METHOD_LABEL: Record<string, string> = {
  sbp_phone: 'СБП · телефон',
  sbp_bank:  'СБП · банк',
  card:      'Банковская карта',
}

export function PayoutPage() {
  const navigate = useNavigate()
  const { data: balance, isLoading: balanceLoading } = useBalance()
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['sellers', 'me'],
    queryFn: getMe,
    staleTime: 60_000,
  })
  const { mutateAsync: requestPayout, isPending } = useRequestPayout()

  const available  = balance?.available ?? 0
  const hasDetails = Boolean(profile?.payout_details)
  const checklist = {
    minAmount: available >= MIN_PAYOUT,
    hasDetails,
    noBlock: profile?.status !== 'blocked',
    noFlag:  true, // TODO: surface real antifraud signal once backend exposes it
  }
  const allOk = Object.values(checklist).every(Boolean)
  const methodLabel = profile?.payout_method ? METHOD_LABEL[profile.payout_method] ?? profile.payout_method : '—'

  async function handleRequest() {
    if (!allOk || !profile?.payout_method) return
    await requestPayout({
      amount: available,
      method: profile.payout_method,
      details: profile.payout_details,
    })
  }

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, paddingBottom: 32 }}>
      {balanceLoading ? (
        /* HeroSkeleton includes a 16px margin so we counteract the vliq-pad left/right */
        <div style={{ margin: '0 -16px' }}>
          <HeroSkeleton />
        </div>
      ) : (
        <HeroBalance available={available} margin="0 0 16px" />
      )}

      {/* Read-only summary fields */}
      <div className="vliq-field">
        <label>Сумма выплаты</label>
        <div className="vliq-field-v">{fmtMoney(available)}</div>
      </div>
      <div className="vliq-field">
        <label>Способ</label>
        <div className="vliq-field-v" style={profile?.payout_method ? undefined : { color: 'var(--vliq-hint)', fontWeight: 500 }}>
          {methodLabel}
        </div>
      </div>
      <div className="vliq-field" style={{ marginBottom: 14 }}>
        <label>Реквизиты</label>
        <div className="vliq-field-v" style={!hasDetails ? { color: 'var(--vliq-hint)', fontWeight: 500 } : undefined}>
          {profile?.payout_details
            ? `•••• ${profile.payout_details.slice(-4)}`
            : profileLoading ? '…' : 'Не заполнено — обновите профиль'}
        </div>
      </div>

      {!hasDetails && !profileLoading && (
        <button
          type="button"
          onClick={() => navigate('/seller/reg')}
          style={{
            display: 'block',
            width: '100%',
            background: 'var(--vliq-field)',
            color: 'var(--vliq-brand)',
            fontSize: 13.5,
            fontWeight: 600,
            padding: '12px 14px',
            borderRadius: 12,
            border: 0,
            cursor: 'pointer',
            marginBottom: 14,
            textAlign: 'left',
          }}
        >
          Заполнить реквизиты →
        </button>
      )}

      {/* Checklist */}
      <div className="vliq-card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--vliq-text)', marginBottom: 10 }}>
          Проверка перед выплатой
        </div>
        <ChecklistItem label={`Минимальная сумма — ${fmtMoney(MIN_PAYOUT)}`} ok={checklist.minAmount} />
        <ChecklistItem label="Реквизиты заполнены"                            ok={checklist.hasDetails} />
        <ChecklistItem label="Блокировок нет"                                  ok={checklist.noBlock} />
        <ChecklistItem label="Подозрительной активности нет"                   ok={checklist.noFlag} />
      </div>

      {/* Info banner */}
      <div
        style={{
          borderRadius: 14,
          padding: '13px 15px',
          display: 'flex',
          gap: 9,
          alignItems: 'flex-start',
          marginBottom: 16,
          background: 'var(--vliq-wn-bg)',
          color: 'var(--vliq-wn-ink)',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <Icon name="clock" size={18} className="flex-none" />
        <span>
          Заявка обрабатывается после проверки администратором.
          Статусы: Новая → В обработке → Выплачена.
        </span>
      </div>

      <Btn loading={isPending} disabled={!allOk} onClick={() => void handleRequest()}>
        {allOk ? `Запросить ${fmtMoney(available)}` : 'Требуется заполнить профиль'}
      </Btn>
    </div>
  )
}
