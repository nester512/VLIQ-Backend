import { useNavigate } from 'react-router-dom'
import { MetricCard } from '@/components/molecules/MetricCard'
import { MetricCardSkeleton, RowSkeleton } from '@/components/atoms/Skeleton'
import { ErrorBoundary } from '@/components/atoms/ErrorBoundary'
import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { MiniBarChart } from '@/components/molecules/MiniBarChart'
import { TopSellersBoard } from '@/components/organisms/TopSellersBoard'
import { EmptyState } from '@/components/molecules/EmptyState'
import { useAdminDashboard } from '@/features/admin/hooks/useAdminDashboard'
import { useUiStore } from '@/store/uiStore'
import { fmtInt, fmtMoney } from '@/utils/formatMoney'

interface QuickNavRowProps {
  icon: 'receipt' | 'pay' | 'users'
  label: string
  counter: number
  tone?: 'wn' | 'ok' | 'hint'
  to: string
}

function QuickNavRow({ icon, label, counter, tone = 'hint', to }: QuickNavRowProps) {
  const navigate = useNavigate()
  const counterColor = tone === 'wn' ? 'var(--vliq-wn-ink)' : tone === 'ok' ? 'var(--vliq-ok-ink)' : 'var(--vliq-hint)'
  return (
    <button type="button" onClick={() => navigate(to)} className="vliq-row">
      <div className="vliq-row-ic" style={{ background: 'var(--vliq-field)', color: 'var(--vliq-hint)' }}>
        <Icon name={icon} size={21} />
      </div>
      <div className="vliq-row-tx">
        <b style={{ fontWeight: 600 }}>{label}</b>
      </div>
      {/* Fixed-width counter cell so all three rows' numbers align on the
          same right gutter regardless of digit count. */}
      <span
        style={{
          flex: 'none',
          minWidth: 36,
          textAlign: 'right',
          marginRight: 6,
          fontSize: 14,
          fontWeight: 800,
          color: counterColor,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {fmtInt(counter)}
      </span>
      <div style={{ flex: 'none', color: 'var(--vliq-hint)' }}>
        <Icon name="chev" size={20} />
      </div>
    </button>
  )
}

function DashContent() {
  const navigate = useNavigate()
  const openSheet = useUiStore((s) => s.openSheet)
  const { data, isLoading } = useAdminDashboard()
  const activeShare = data && data.sellers_total > 0
    ? `${Math.round((data.sellers_active / data.sellers_total) * 100)}% базы`
    : '—'

  return (
    <div>
      {/* Page header */}
      <div className="vliq-pad" style={{ paddingTop: 14, paddingBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--vliq-text)', letterSpacing: '-.3px' }}>
          Сводка
        </h1>
        <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--vliq-hint)', marginTop: 4 }}>
          VLIQ · обновлено сейчас
        </p>
      </div>

      {/* Metric grid */}
      <div
        className="vliq-pad"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10, marginBottom: 14 }}
      >
        {isLoading ? (
          <>
            <MetricCardSkeleton /><MetricCardSkeleton />
            <MetricCardSkeleton /><MetricCardSkeleton />
            <MetricCardSkeleton /><MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard title="Продавцов"      value={fmtInt(data?.sellers_total)}    delta={data?.sellers_total ? 'всего в базе' : '—'} deltaColor="hint" />
            <MetricCard title="Активных"        value={fmtInt(data?.sellers_active)}   delta={activeShare}                                deltaColor="ok"   />
            <MetricCard title="Чеков загружено" value={fmtInt(data?.receipts_loaded)}  delta="за всё время"                              deltaColor="hint" tween />
            <MetricCard title="На проверке"     value={fmtInt(data?.receipts_pending)} delta={data && data.receipts_pending > 0 ? 'требует действий' : 'очередь пуста'} deltaColor={data && data.receipts_pending > 0 ? 'wn' : 'hint'} onClick={() => navigate('/admin/review')} />
            <MetricCard title="Средний чек"     value={data?.avg_check ? fmtMoney(data.avg_check) : '—'} delta="продажи (наши товары)" deltaColor="hint" />
            <MetricCard title="Выплачено"        value={fmtInt(data?.payouts_paid_month)} delta="заявок выплачено" deltaColor="ok" />
          </>
        )}
      </div>

      {/* Chart card */}
      <div className="vliq-pad" style={{ marginBottom: 14 }}>
        <div className="vliq-card" style={{ padding: '18px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b style={{ fontSize: 15, fontWeight: 700, color: 'var(--vliq-text)' }}>Динамика чеков</b>
              <span
                style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase',
                  color: 'var(--vliq-hint)', background: 'var(--vliq-field)',
                  padding: '3px 7px', borderRadius: 6,
                }}
              >
                бета
              </span>
            </div>
            <Pill kind="ok">{data?.receipts_loaded ? `${data.receipts_loaded}` : '0'}</Pill>
          </div>

          {isLoading || !data ? (
            <div className="bg-[var(--vliq-field)] rounded-[8px] animate-pulse" style={{ height: 112 }} />
          ) : (
            <MiniBarChart
              data={data.chart.values}
              max={data.chart.max}
              startLabel={data.chart.labels[0]}
              middleLabel={data.chart.labels[1]}
              endLabel={data.chart.labels[2]}
              height={112}
            />
          )}
        </div>
      </div>

      {/* Quick nav — real counts */}
      <div className="vliq-pad" style={{ marginBottom: 14 }}>
        <div className="vliq-list">
          <QuickNavRow icon="receipt" label="Проверить чеки"   counter={data?.receipts_pending ?? 0} tone={(data?.receipts_pending ?? 0) > 0 ? 'wn' : 'hint'} to="/admin/review" />
          <QuickNavRow icon="pay"     label="Заявки на выплату" counter={data?.payouts_pending  ?? 0} tone={(data?.payouts_pending  ?? 0) > 0 ? 'wn' : 'hint'} to="/admin/payouts" />
          <QuickNavRow icon="users"   label="Продавцы"          counter={data?.sellers_total    ?? 0} tone="hint"                                              to="/admin/sellers" />
        </div>
      </div>

      {/* Top sellers — collapsed → expandable */}
      <div className="vliq-pad">
        <div className="vliq-sec-t">
          <b>Топ продавцов</b>
        </div>
        {isLoading ? (
          <div className="vliq-list">
            <RowSkeleton /><RowSkeleton /><RowSkeleton />
          </div>
        ) : data && data.top_sellers.length > 0 ? (
          <TopSellersBoard
            sellers={data.top_sellers}
            collapsedCount={3}
            onSelect={(s) => {
              if (s.telegram_id) openSheet('seller', { telegram_id: s.telegram_id })
              else navigate('/admin/sellers')
            }}
          />
        ) : (
          <EmptyState
            icon="users"
            tone="muted"
            title="Данных пока нет"
            description="Топ продавцов появится, когда пройдут первые одобрения чеков."
          />
        )}
      </div>

      {/* UC-01 — товары, отсортированные по количеству */}
      <div className="vliq-pad" style={{ paddingBottom: 20 }}>
        <div className="vliq-sec-t">
          <b>Товары по количеству</b>
        </div>
        {isLoading ? (
          <div className="vliq-list"><RowSkeleton /><RowSkeleton /><RowSkeleton /></div>
        ) : data && data.top_products.length > 0 ? (
          <div className="vliq-list">
            {data.top_products.map((p, i) => (
              <div key={`${p.name}-${i}`} className="vliq-row is-static">
                <div className="vliq-row-ic" style={{ background: 'var(--vliq-field)', color: 'var(--vliq-hint)', fontWeight: 800 }}>
                  {i + 1}
                </div>
                <div className="vliq-row-tx" style={{ minWidth: 0 }}>
                  <b style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</b>
                </div>
                <span style={{ flex: 'none', marginRight: 6, fontSize: 14, fontWeight: 800, color: 'var(--vliq-text)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtInt(p.count)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="list" tone="muted" title="Товаров пока нет" description="Появятся после распознавания первых чеков." />
        )}
      </div>
    </div>
  )
}

export function DashPage() {
  return (
    <ErrorBoundary>
      <DashContent />
    </ErrorBoundary>
  )
}
