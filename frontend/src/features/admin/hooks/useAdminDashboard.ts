import { useQuery } from '@tanstack/react-query'
import { getAdminDashboard, type AdminDashboardResponse } from '@/api/admin'

export interface ChartData {
  /** Receipts uploaded per day (last 30 days, zero-filled by the server). */
  values: number[]
  /** Max bucket count (≥1) — the y-axis top tick; bars scale to this. */
  max: number
  /** [start, middle, end] calendar-date labels for the x-axis (e.g. «1 июн»). */
  labels: [string, string, string]
}

export interface DashboardData {
  sellers_total: number
  sellers_active: number
  receipts_loaded: number
  receipts_pending: number
  payouts_pending: number
  payouts_paid_month: number
  /** Receipt-dynamics bar chart: real per-bucket counts + axis tick labels. */
  chart: ChartData
  /** UC-01 — средний чек продажи (mean approved total_sum). */
  avg_check: number
  /** UC-01 — сводная таблица товаров, отсортированная по кол-ву. */
  top_products: Array<{ name: string; count: number }>
  top_sellers: Array<{
    telegram_id?: number
    name: string
    city: string
    receipts: string
    /** UC-01 — сумма продаж (наших товаров) и сумма выплат по продавцу. */
    sales: number
    paid: number
    /** Начислено за всё время — по нему сервер ранжирует топ. */
    accrued: number
  }>
}

/**
 * Admin dashboard — ONE call to `GET /analytics/dashboard`, where every metric is
 * aggregated in SQL over the whole database. It used to be derived client-side
 * from the first 200 rows of four list endpoints, so on real volumes everything
 * except the plain totals (top sellers, average check, paid-this-month, chart)
 * was computed over a sample and was wrong.
 */
export function useAdminDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['admin', 'dashboard'],
    staleTime: 30_000,
    queryFn: async () => toDashboardData(await getAdminDashboard()),
  })
}

const RU_DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fmtDay = (isoDay: string) => RU_DAY.format(new Date(`${isoDay}T00:00:00Z`))

/** Map the server DTO onto the shape DashPage renders (A4: same metrics, now correct). */
export function toDashboardData(d: AdminDashboardResponse): DashboardData {
  const days = d.daily_receipts
  const values = days.map((x) => x.receipts)
  const chart: ChartData = days.length
    ? {
        values,
        max: Math.max(...values, 1),
        labels: [
          fmtDay(days[0]!.day),
          fmtDay(days[Math.floor((days.length - 1) / 2)]!.day),
          fmtDay(days[days.length - 1]!.day),
        ],
      }
    : { values: [], max: 1, labels: ['—', '—', '—'] }

  return {
    sellers_total: d.sellers_total,
    sellers_active: d.sellers_active,
    receipts_loaded: d.receipts_total,
    receipts_pending: d.receipts_on_review,
    payouts_pending: d.payouts_pending,
    payouts_paid_month: d.payouts_paid_month,
    chart,
    avg_check: d.avg_check,
    top_products: d.top_products,
    top_sellers: d.top_sellers.map((s) => ({
      telegram_id: s.telegram_id,
      name: s.name,
      city: s.city ?? '—',
      receipts: s.receipts_approved > 0 ? `${s.receipts_approved} одобрено` : `${s.receipts_total} чеков`,
      sales: s.sales,
      paid: s.paid,
      accrued: s.total_accrued ?? 0,
    })),
  }
}
