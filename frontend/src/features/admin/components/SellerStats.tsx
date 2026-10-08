import { Pill } from '@/components/atoms/Pill'
import { KVRow } from '@/components/molecules/KVRow'
import { fmtInt, fmtMoney } from '@/utils/formatMoney'
import { formatDate } from '@/utils/formatDate'
import type { AdminSellerDetail, SellerStats, SellerWeekActivity } from '@/api/admin'
import { RISK_FLAG_LABEL, RISK_KIND, RISK_LABEL } from '@/features/admin/sellerRisk'

export function RiskPill({ stats, withScore = false }: { stats?: SellerStats; withScore?: boolean }) {
  if (!stats) return null
  return (
    <Pill kind={RISK_KIND[stats.risk_level]}>
      {withScore ? `${RISK_LABEL[stats.risk_level]} · ${stats.risk_score}` : RISK_LABEL[stats.risk_level]}
    </Pill>
  )
}

const fmtDateOrDash = (iso: string | null | undefined) => (iso ? formatDate(iso) : '—')

/** 12 weekly bars: uploaded (light) with the approved share (solid) on top. */
export function WeeklyActivity({ weeks }: { weeks: SellerWeekActivity[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.receipts))
  return (
    <div>
      <div
        role="img"
        aria-label={`Активность по неделям: ${weeks.map((w) => w.receipts).join(', ')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 64 }}
      >
        {weeks.map((w) => (
          <div
            key={w.week_start}
            title={`Неделя с ${formatDate(w.week_start)}: ${w.receipts} чеков, ${w.approved} одобрено`}
            style={{
              flex: 1,
              height: `${Math.max(4, (w.receipts / max) * 100)}%`,
              background: w.receipts ? 'var(--vliq-field)' : 'transparent',
              borderBottom: '2px solid var(--vliq-field)',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'flex-end',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '100%',
                height: w.receipts ? `${(w.approved / w.receipts) * 100}%` : 0,
                background: 'var(--vliq-brand)',
              }}
            />
          </div>
        ))}
      </div>
      {weeks.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--vliq-hint)', marginTop: 6 }}>
          <span>{formatDate(weeks[0]!.week_start)}</span>
          <span>12 недель · одобрено / загружено</span>
        </div>
      )}
    </div>
  )
}

/** Balance, receipt activity, risk and weekly history of one seller. */
export function SellerStatsPanel({ seller }: { seller: AdminSellerDetail }) {
  const stats = seller.stats
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="vliq-card" style={{ padding: '0 16px' }}>
        <KVRow label="Баланс" value={fmtMoney(seller.balance)} valueStyle={{ color: 'var(--vliq-ok-ink)' }} />
        <KVRow label="Начислено всего" value={fmtMoney(seller.total_accrued)} />
        <KVRow label="Выплачено" value={fmtMoney(seller.total_paid_out)} />
        <KVRow label="На удержании" value={fmtMoney(seller.on_hold)} />
        <KVRow label="Средний бонус" value={fmtMoney(seller.avg_bonus)} />
      </div>

      {stats && (
        <div className="vliq-card" style={{ padding: '0 16px' }}>
          <KVRow label="Чеков всего" value={fmtInt(stats.receipts_total)} />
          <KVRow label="Одобрено" value={fmtInt(stats.receipts_approved)} />
          <KVRow label="Отклонено" value={fmtInt(stats.receipts_rejected)} />
          <KVRow label="На проверке" value={fmtInt(stats.receipts_on_review)} />
          <KVRow label="За 30 дней" value={fmtInt(stats.receipts_30d)} />
          <KVRow label="Первый чек" value={fmtDateOrDash(stats.first_receipt_at)} />
          <KVRow label="Последний чек" value={fmtDateOrDash(stats.last_receipt_at)} />
        </div>
      )}

      {stats && (
        <div className="vliq-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <b style={{ fontSize: 14, color: 'var(--vliq-text)' }}>Фактор риска</b>
            <RiskPill stats={stats} withScore />
          </div>
          {stats.risk_flags.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--vliq-hint)', lineHeight: 1.5 }}>
              {stats.risk_flags.map((f) => (
                <li key={f}>{RISK_FLAG_LABEL[f] ?? f}</li>
              ))}
            </ul>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--vliq-hint)' }}>Признаков риска не найдено</p>
          )}
          {stats.receipts_duplicates > 0 && (
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--vliq-hint)' }}>
              Чеков с признаком дубля: {fmtInt(stats.receipts_duplicates)}
            </p>
          )}
        </div>
      )}

      {seller.weekly_activity.length > 0 && (
        <div className="vliq-card" style={{ padding: 16 }}>
          <b style={{ display: 'block', fontSize: 14, color: 'var(--vliq-text)', marginBottom: 10 }}>Активность</b>
          <WeeklyActivity weeks={seller.weekly_activity} />
        </div>
      )}
    </div>
  )
}
