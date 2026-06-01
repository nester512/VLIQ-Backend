import { useNavigate } from 'react-router-dom'
import { Avatar } from '@/components/atoms/Avatar'
import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { Spinner } from '@/components/atoms/Spinner'
import { KVRow } from '@/components/molecules/KVRow'
import { getInitials, getFullName } from '@/utils/initials'
import { fmtMoney } from '@/utils/formatMoney'
import { useUiStore } from '@/store/uiStore'
import { useSellerDetail, useSellerStatusToggle } from '@/features/admin/hooks/useSellersList'

interface SellerDetailSheetProps {
  telegram_id: number | null
}

export function SellerDetailSheet({ telegram_id }: SellerDetailSheetProps) {
  const navigate = useNavigate()
  const closeSheet = useUiStore((s) => s.closeSheet)
  const { data: seller, isLoading, isError } = useSellerDetail(telegram_id ?? undefined)
  const { mutate: toggleStatus, isPending: togglePending } = useSellerStatusToggle()

  if (isLoading) {
    return (
      <div className="vliq-pad" style={{ padding: '48px 16px', display: 'grid', placeItems: 'center' }}>
        <Spinner size={28} className="text-[var(--vliq-brand)]" />
      </div>
    )
  }

  if (isError || !seller) {
    return (
      <div className="vliq-pad" style={{ padding: '32px 16px', textAlign: 'center' }}>
        <p style={{ color: 'var(--vliq-hint)', fontSize: 14 }}>Не удалось загрузить продавца</p>
      </div>
    )
  }

  const fullName = getFullName(seller, seller.telegram_id ?? telegram_id ?? undefined)
  const initials = getInitials(seller)
  const isBlocked = seller.status === 'blocked'
  const isPending = seller.status === 'pending'

  const dateFmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  return (
    <div className="vliq-pad" style={{ paddingTop: 6, paddingBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 4, marginBottom: 16 }}>
        <Avatar initials={initials} size={52} className="rounded-[15px]" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--vliq-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fullName}
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--vliq-hint)' }}>
            {seller.position ?? 'Продавец'}
          </div>
        </div>
        <Pill kind={isBlocked ? 'dg' : isPending ? 'wn' : 'ok'}>
          {isBlocked ? 'Блок' : isPending ? 'Ожидает' : 'Активен'}
        </Pill>
      </div>

      <div className="vliq-card" style={{ padding: '0 16px', marginBottom: 16 }}>
        <KVRow label="Город"            value={seller.city ?? '—'} />
        <KVRow label="Торговая точка"   value={seller.store_name ?? '—'} />
        <KVRow label="Телефон"          value={seller.phone ?? '—'} />
        <KVRow
          label="Дата регистрации"
          value={seller.registered_at ? dateFmt.format(new Date(seller.registered_at)) : '—'}
        />
        <KVRow label="Баланс" value={fmtMoney(seller.balance)} valueStyle={{ color: 'var(--vliq-ok-ink)' }} />
        <KVRow
          label="Чеков всего"
          value={
            seller.receipts_total != null
              ? `${seller.receipts_total} · ${seller.receipts_approved ?? 0} одобрено`
              : '—'
          }
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <button
          type="button"
          disabled={telegram_id == null}
          onClick={() => {
            if (telegram_id == null) return
            closeSheet()
            navigate(`/admin/sellers/${telegram_id}/receipts`)
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: 12, borderRadius: 14, fontSize: 13, fontWeight: 700,
            background: 'var(--vliq-field)', color: 'var(--vliq-text)',
            border: 0, cursor: telegram_id == null ? 'not-allowed' : 'pointer',
          }}
        >
          <Icon name="receipt" size={18} />
          К чекам
        </button>
        <button
          type="button"
          disabled={togglePending || telegram_id == null}
          onClick={() => {
            if (telegram_id == null) return
            toggleStatus({
              telegram_id,
              status: isBlocked ? 'active' : 'blocked',
              blockReason: isBlocked ? undefined : 'Заблокирован администратором',
            })
          }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: 12, borderRadius: 14, fontSize: 13, fontWeight: 700,
            background: isBlocked ? 'var(--vliq-ok-bg)' : 'var(--vliq-dg-bg)',
            color: isBlocked ? 'var(--vliq-ok-ink)' : 'var(--vliq-dg-ink)',
            border: 0,
            cursor: togglePending ? 'not-allowed' : 'pointer',
            opacity: togglePending ? 0.6 : 1,
          }}
        >
          <Icon name={isBlocked ? 'check' : 'block'} size={18} />
          {isBlocked ? 'Разблокировать' : 'Заблокировать'}
        </button>
      </div>
    </div>
  )
}
