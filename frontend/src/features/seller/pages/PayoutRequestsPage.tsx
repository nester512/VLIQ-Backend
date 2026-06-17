import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Pill } from '@/components/atoms/Pill'
import { Icon } from '@/components/atoms/Icon'
import { RowSkeleton } from '@/components/atoms/Skeleton'
import { EmptyState } from '@/components/molecules/EmptyState'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { getMyPayoutRequests } from '@/api/payouts'
import { fmtMoney } from '@/utils/formatMoney'
import type { PayoutStatus } from '@/types/models'

const STATUS: Record<PayoutStatus, { label: string; kind: 'ok' | 'wn' | 'dg' }> = {
  new:         { label: 'Новая',       kind: 'wn' },
  in_progress: { label: 'В обработке', kind: 'wn' },
  paid:        { label: 'Выплачена',   kind: 'ok' },
  rejected:    { label: 'Отклонена',   kind: 'dg' },
}

const METHOD_LABEL: Record<string, string> = {
  sbp_phone: 'СБП · телефон',
  sbp_bank:  'СБП · банк',
  card:      'Карта',
}

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

function PayoutRequestsContent() {
  const navigate = useNavigate()
  const { data: requests, isLoading } = useQuery({
    queryKey: ['payouts', 'me'],
    queryFn: getMyPayoutRequests,
    staleTime: 15_000,
  })

  const list = requests ?? []

  return (
    <div className="vliq-pad" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button type="button" onClick={() => navigate('/seller/payout')} className="vliq-press"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--vliq-brand)', color: '#fff', border: 0, borderRadius: 14, padding: '13px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
        <Icon name="cashout" size={18} /> Запросить выплату
      </button>

      {isLoading ? (
        <div className="vliq-list"><RowSkeleton /><RowSkeleton /><RowSkeleton /></div>
      ) : list.length === 0 ? (
        <EmptyState icon="cashout" tone="brand"
          title="Заявок пока нет"
          description="Запросите выплату — заявка появится здесь со статусом." />
      ) : (
        <div className="vliq-list">
          {list.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, kind: 'wn' as const }
            const method = r.method ? METHOD_LABEL[r.method] ?? r.method : ''
            const dest = r.details ? `•••• ${r.details.slice(-4)}` : ''
            return (
              <div key={r.id} className="vliq-row is-static" style={{ alignItems: 'center' }}>
                <div className="vliq-row-tx" style={{ minWidth: 0 }}>
                  <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.amount)}</b>
                  <span>{[method, dest].filter(Boolean).join(' · ')}{r.created_at ? ` · ${fmtDate(r.created_at)}` : ''}</span>
                </div>
                <div style={{ flex: 'none', marginRight: 2 }}>
                  <Pill kind={st.kind}>{st.label}</Pill>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function PayoutRequestsPage() {
  return (
    <ErrorBoundary>
      <PayoutRequestsContent />
    </ErrorBoundary>
  )
}
