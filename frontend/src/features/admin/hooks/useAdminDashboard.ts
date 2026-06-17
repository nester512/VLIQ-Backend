import { useQuery } from '@tanstack/react-query'
import { getAdminSellers, getAdminPayouts, getAdminReceipts } from '@/api/admin'
import { isApprovedStatus } from '@/utils/receiptStatus'
import type { AdminSellerRow } from '@/api/admin'

export interface DashboardData {
  sellers_total: number
  sellers_active: number
  receipts_loaded: number
  receipts_pending: number
  payouts_pending: number
  payouts_paid_month: number
  /** Heights 0–100 for the placeholder bar chart (10 buckets). */
  chart: number[]
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
  }>
}

/**
 * Real dashboard aggregate — derived client-side from the existing list
 * endpoints because the backend hasn't shipped `/analytics/dashboard` yet.
 * Once it does, swap the four parallel queries below for a single call.
 */
export function useAdminDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['admin', 'dashboard'],
    staleTime: 30_000,
    queryFn: async () => {
      // Fetch receipts for chart/top_sellers (up to 200), plus a lightweight
      // probe for pending-receipt count using limit=1 (reads server total only).
      const [sellersPage, payoutsPage, receiptsPage, pendingProbe] = await Promise.all([
        getAdminSellers({ limit: 200 }),
        getAdminPayouts({ limit: 200 }),
        getAdminReceipts({ limit: 200 }),
        // Use the same status filter the review-queue uses so the dashboard
        // counter never disagrees with what /admin/review actually shows.
        // (Pending = still in the pipeline worker. Needs_revision = terminal
        // for seller to re-upload. Neither is actionable by admin.)
        getAdminReceipts({ status: ['on_review'], limit: 1 }),
      ])

      const sellers = sellersPage.items
      const payouts = payoutsPage.items
      const receipts = receiptsPage.items

      const sellers_active = sellers.filter((s) => s.is_active).length
      // Use server total from the pending-only probe — accurate even if receipts
      // window (200) doesn't cover all pending records.
      const receipts_pending = pendingProbe.total
      const payouts_pending = payouts.filter((p) => p.status === 'new' || p.status === 'in_progress').length
      const payouts_paid_month = payouts.filter((p) => p.status === 'paid').length

      // Top sellers by approved receipt count (tie-break by total). Computed
      // here so admins see the same ranking the seller "Чеки" tab implies.
      const receiptsBySeller = new Map<number, { approved: number; total: number }>()
      for (const r of receipts) {
        const cur = receiptsBySeller.get(r.seller_id) ?? { approved: 0, total: 0 }
        cur.total += 1
        if (isApprovedStatus(r.status)) cur.approved += 1
        receiptsBySeller.set(r.seller_id, cur)
      }
      const sellersWithCounts: Array<AdminSellerRow & { approved: number; total: number }> = sellers.map((s) => {
        const counts = receiptsBySeller.get(s.telegram_id ?? s.id) ?? { approved: 0, total: 0 }
        return { ...s, ...counts }
      })
      sellersWithCounts.sort((a, b) => (b.approved - a.approved) || (b.total - a.total))

      // UC-01: per-seller sales (Σ approved total_sum) and payouts (Σ paid).
      const salesBySeller = new Map<number, number>()
      for (const r of receipts) {
        if (isApprovedStatus(r.status) && typeof r.amount === 'number') {
          salesBySeller.set(r.seller_id, (salesBySeller.get(r.seller_id) ?? 0) + r.amount)
        }
      }
      const paidBySeller = new Map<number, number>()
      for (const p of payouts) {
        if (p.status === 'paid') {
          paidBySeller.set(p.seller_id, (paidBySeller.get(p.seller_id) ?? 0) + p.amount)
        }
      }

      const top_sellers = sellersWithCounts.slice(0, 25).map((s) => {
        const sid = s.telegram_id ?? s.id
        return {
          telegram_id: s.telegram_id,
          name: [s.first_name, s.last_name].filter(Boolean).join(' ') || `Продавец #${s.telegram_id ?? s.id}`,
          city: s.city ?? '—',
          receipts: s.approved > 0 ? `${s.approved} одобрено` : `${s.total} чеков`,
          sales: salesBySeller.get(sid) ?? 0,
          paid: paidBySeller.get(sid) ?? 0,
        }
      })

      // UC-01: средний чек продажи — mean total_sum over approved receipts.
      const approvedAmounts = receipts
        .filter((r) => isApprovedStatus(r.status) && typeof r.amount === 'number')
        .map((r) => r.amount as number)
      const avg_check = approvedAmounts.length
        ? Math.round(approvedAmounts.reduce((sum, a) => sum + a, 0) / approvedAmounts.length)
        : 0

      // UC-01: сводная таблица товаров, отсортированная по количеству.
      const productCounts = new Map<string, number>()
      for (const r of receipts) {
        for (const it of r.items ?? []) {
          const name = (it.name ?? '').trim() || '—'
          productCounts.set(name, (productCounts.get(name) ?? 0) + (it.qty ?? 1))
        }
      }
      const top_products = [...productCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15)

      // Chart placeholder — until backend ships a time-series we bucket
      // received receipts into 10 even slices across their date range.
      const chart = buildChartBuckets(receipts.map((r) => r.created_at))

      return {
        sellers_total: sellers.length,
        sellers_active,
        receipts_loaded: receipts.length,
        receipts_pending,
        payouts_pending,
        payouts_paid_month,
        chart,
        avg_check,
        top_products,
        top_sellers,
      }
    },
  })
}

function buildChartBuckets(dates: string[], buckets = 10): number[] {
  if (dates.length === 0) return new Array(buckets).fill(0)
  const ts = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b)
  const min = ts[0]!
  const max = ts[ts.length - 1]!
  if (min === max) {
    const out = new Array(buckets).fill(0)
    out[buckets - 1] = dates.length
    return out
  }
  const step = (max - min) / buckets
  const counts = new Array(buckets).fill(0)
  for (const t of ts) {
    const idx = Math.min(buckets - 1, Math.floor((t - min) / step))
    counts[idx] += 1
  }
  const top = Math.max(...counts, 1)
  return counts.map((c) => Math.round((c / top) * 100))
}
