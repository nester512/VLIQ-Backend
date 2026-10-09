import { api } from './client'
import type {
  Receipt, PayoutRequest, SellerProfile, PayoutMethod, ReceiptStatus, Attachment, AttachmentKind,
} from '../types/models'

// ---- Filters ----

export type ReviewAction = 'approve' | 'reject' | 'revise'

export interface ReceiptReviewActionPayload {
  comment?: string | null
  /** Bonus amount in kopecks. Required by backend when approving a receipt with no recognized bonus. */
  bonusAmountKopecks?: number | null
}

export interface AdminReceiptsFilters {
  status?: string[]
  seller_id?: number
  from?: string   // ISO date
  to?: string     // ISO date
  page?: number
  limit?: number
  /** `asc` (default) = review queue FIFO; `desc` = newest first (seller history). */
  order?: 'asc' | 'desc'
}

export interface AdminPayoutsFilters {
  status?: string
  page?: number
  limit?: number
  search?: string
  /** By creation time: newest first (default) or oldest first. */
  order?: 'desc' | 'asc'
}

export type SellerRiskLevel = 'low' | 'medium' | 'high'

/** Server-side sort keys of GET /sellers (`field:dir`). */
export type SellerSortField =
  | 'created_at'
  | 'last_receipt_at'
  | 'receipts_total'
  | 'receipts_30d'
  | 'risk_score'

export interface AdminSellersFilters {
  status?: string
  page?: number
  limit?: number
  search?: string
  /** `field:dir`, e.g. `receipts_total:desc` (популярность), `receipts_30d:desc` (частота). */
  sort?: `${SellerSortField}:${'asc' | 'desc'}`
  risk?: SellerRiskLevel
  city?: string
  has_on_review?: boolean
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

// ---- Domain shapes returned by the admin endpoints ----

/** A fiscal identity {ФН / ФД / ФП} — one receipt may carry several when a
 *  single upload accidentally bundled multiple distinct receipts. */
export interface FiscalIdentity {
  fn?: string
  fd?: string
  fp?: string
}

/** Normalised, display-ready fraud signal. `details` is human-readable text. */
export interface AdminFraudSignal {
  /** Backend `signal` slug (e.g. `multiple_receipts_detected`). */
  type: string
  /** Advisory severity from backend (`info` | `warning` | `danger` | …). */
  severity?: string
  /** Russian, ready-to-render description. */
  details: string
  /** Set for historical duplicates — the receipt this one duplicates. */
  duplicate_of_id?: number
}

export interface AdminReceipt extends Receipt {
  seller_name?: string
  seller_store?: string
  fraud_signal?: AdminFraudSignal[]
  rejection_reason?: string
  fn?: string
  fd?: string
  fp?: string
  shop_address?: string
  purchase_date?: string
  duplicate_status?: 'ok' | 'warn' | 'danger'
  duplicate_label?: string
  /** Ordered package attachments (1–5 images and/or PDFs). */
  attachments: Attachment[]
  /** Distinct fiscal identities found in the upload (from `multiple_receipts_detected`
   *  details.identities, or ocr_raw.detected_identities). */
  detected_identities?: FiscalIdentity[]
  /** Per-attachment extraction warnings, surfaced from `ocr_raw.extraction_evidence`. */
  extraction_warnings?: string[]
  /** QR intake: how the seller produced the data (null for legacy file uploads). */
  source?: ReceiptSourceT
  /** Automatic OFD check (independent of the moderation status). */
  verification_status?: VerificationStatus
  verification_attempts?: number
  next_verification_at?: string
  verified_at?: string
  /** Check provider that confirmed the receipt. */
  verified_by?: string
}

export type ReceiptSourceT = 'telegram_scan' | 'camera_scan' | 'image_decode' | 'pdf_decode' | 'manual'
export type VerificationStatus = 'not_required' | 'pending' | 'retrying' | 'verified' | 'failed'

/** One call to a check provider — exactly what was asked and answered (reproducible). */
export interface ReceiptCheck {
  id: number
  attempt_no: number
  round_no: number | null
  provider: string
  provider_role: 'main' | 'fallback' | null
  adapter_version: string | null
  method: string
  trigger: 'pipeline' | 'cron' | 'admin'
  outcome: 'ok' | 'not_found' | 'invalid' | 'rate_limited' | 'error' | 'blocked'
  http_status: number | null
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  parsed: Record<string, unknown> | null
  error: string | null
  duration_ms: number | null
  created_at: string
}

export interface JourneyEvent {
  seq: number
  at: string
  kind: string
  actor_type: 'seller' | 'system' | 'admin'
  actor_id: number | null
  source: string | null
  outcome: string | null
  data: Record<string, unknown> | null
  check: ReceiptCheck | null
}

export interface CheckProvider {
  code: string
  title: string
  role: 'main' | 'fallback'
  priority: number
  enabled: boolean
  /** An adapter with credentials exists in this deployment. */
  available: boolean
  disabled_until: string | null
  consecutive_failures: number
}

export interface ReceiptJourney {
  receipt_id: number
  summary: {
    received_at: string | null
    intake_source: string | null
    status: ReceiptStatus
    verification_status: VerificationStatus
    verified_by: string | null
    verified_at: string | null
    check_rounds: number
    next_check_at: string | null
    decision: 'approved' | 'rejected' | 'sent_to_revision' | null
    decided_at: string | null
    decided_by: number | null
  }
  events: JourneyEvent[]
  providers: CheckProvider[]
}

/** Receipt activity + moderation risk of a seller, aggregated on the server. */
export interface SellerStats {
  receipts_total: number
  /** approved + paid_out */
  receipts_approved: number
  receipts_rejected: number
  receipts_on_review: number
  /** Uploads in the last 30 days — activity frequency. */
  receipts_30d: number
  receipts_duplicates: number
  first_receipt_at: string | null
  last_receipt_at: string | null
  /** 0..100 moderation heuristic (formula pending product confirmation). */
  risk_score: number
  risk_level: SellerRiskLevel
  /** `low_data` | `high_reject_rate` | `duplicates` */
  risk_flags: string[]
}

export interface SellerWeekActivity {
  week_start: string
  receipts: number
  approved: number
}

export interface AdminSellerRow extends SellerProfile {
  receipts_total?: number
  receipts_approved?: number
  /** Spendable balance (kopecks) — only on the single-seller endpoint. */
  balance?: number
  registered_at?: string
  block_reason?: string
  stats?: SellerStats
}

/** GET /sellers/{id}: the list row plus balance breakdown and weekly history. */
export interface AdminSellerDetail extends AdminSellerRow {
  total_accrued: number
  total_paid_out: number
  on_hold: number
  /** Mean bonus of approved receipts, kopecks. */
  avg_bonus: number
  weekly_activity: SellerWeekActivity[]
}

/** Alias for callers that prefer the shorter name. */
export type AdminSeller = AdminSellerRow

// ---- Backend wire types ----

interface BackendSeller {
  telegram_id: number
  brand_id: number
  phone_e164: string
  first_name?: string | null
  last_name?: string | null
  city?: string | null
  outlet_name?: string | null
  outlet_address?: string | null
  position?: string | null
  status: 'pending' | 'active' | 'blocked'
  block_reason?: string | null
  payout_kind?: PayoutMethod | null
  payout_masked?: string | null
  created_at: string
  updated_at?: string | null
  /** Present on GET /sellers rows and GET /sellers/{id}. */
  stats?: SellerStats
}

/** GET /sellers/{telegram_id} — SellerReadAdmin. */
interface BackendSellerDetail extends BackendSeller {
  balance_available: number
  receipts_total: number
  stats: SellerStats
  total_accrued: number
  total_paid_out: number
  on_hold: number
  avg_bonus: number
  weekly_activity: SellerWeekActivity[]
}

interface BackendPayoutRequest {
  id: number
  seller_id: number
  seller_name?: string | null
  seller_store?: string | null
  seller_status?: string | null
  brand_id: number
  amount: number
  payout_kind: PayoutMethod
  payout_masked: string
  status: 'new' | 'in_progress' | 'paid' | 'rejected'
  admin_comment?: string | null
  external_txn_id?: string | null
  created_at: string
  updated_at?: string | null
  taken_at?: string | null
  paid_at?: string | null
  rejected_at?: string | null
}

/** Wire shape for a single receipt attachment (backend ReceiptAttachmentRead). */
interface BackendAttachment {
  id: number
  position: number
  kind: AttachmentKind
  mime_type: string
  url?: string | null
}

/** Per-position extraction evidence inside ocr_raw.extraction_evidence. */
interface BackendExtractionEvidence {
  kind?: string
  qr_candidates?: number
  pdf_pages?: number
  warnings?: string[]
}

/** Backend ReceiptFraudSignal shape — `signal` not `type`. */
interface BackendFraudSignal {
  signal: string
  severity?: string
  details?: Record<string, unknown> | string | null
  duplicate_of_id?: number
}

/** Subset of the backend ocr_raw JSON the admin info card consumes. */
interface BackendOcrRaw {
  extraction_evidence?: Record<string, BackendExtractionEvidence | null> | null
  detected_identities?: Array<{ fn?: string | null; fd?: string | null; fp?: string | null }> | null
  [key: string]: unknown
}

interface BackendReceipt {
  id: number
  seller_id: number
  seller_name?: string | null
  seller_store?: string | null
  brand_id?: number
  status: ReceiptStatus
  bonus_amount?: number
  rejection_reason?: string | null
  rejection_code?: string | null
  file_url?: string
  attachments?: BackendAttachment[] | null
  shop_name?: string | null
  shop_inn?: string | null
  shop_address?: string | null
  total_sum?: number | null
  purchase_date?: string | null
  fn?: string | null
  fd?: string | null
  fp?: string | null
  items?: Array<{ raw_name?: string; name?: string; price: number; qty?: number }>
  // Backend ReceiptFraudSignal shape — `signal` not `type`, plus severity + duplicate_of_id.
  fraud_signals?: BackendFraudSignal[]
  ocr_raw?: BackendOcrRaw | null
  source?: ReceiptSourceT | null
  verification_status?: VerificationStatus
  verification_attempts?: number
  next_verification_at?: string | null
  verified_at?: string | null
  verified_by?: string | null
  created_at: string
  updated_at?: string | null
}

// ---- Mappers ----

function mapAdminSeller(s: BackendSeller): AdminSellerRow {
  return {
    id: s.telegram_id,
    telegram_id: s.telegram_id,
    brand_id: s.brand_id,
    first_name: s.first_name ?? undefined,
    last_name: s.last_name ?? undefined,
    phone: s.phone_e164,
    city: s.city ?? undefined,
    store_name: s.outlet_name ?? undefined,
    store_address: s.outlet_address ?? undefined,
    position: s.position ?? undefined,
    payout_method: s.payout_kind ?? undefined,
    payout_details: s.payout_masked ?? undefined,
    is_active: s.status === 'active',
    status: s.status,
    block_reason: s.block_reason ?? undefined,
    registered_at: s.created_at,
    stats: s.stats,
    receipts_total: s.stats?.receipts_total,
    receipts_approved: s.stats?.receipts_approved,
  }
}

/**
 * Detail mapper. The plain list mapper used to be applied here too, which
 * silently dropped `balance_available` / `receipts_total` — the card then showed
 * «—» for balance and receipt count of every seller.
 */
export function mapAdminSellerDetail(s: BackendSellerDetail): AdminSellerDetail {
  return {
    ...mapAdminSeller(s),
    balance: s.balance_available,
    receipts_total: s.receipts_total,
    receipts_approved: s.stats.receipts_approved,
    total_accrued: s.total_accrued,
    total_paid_out: s.total_paid_out,
    on_hold: s.on_hold,
    avg_bonus: s.avg_bonus,
    weekly_activity: s.weekly_activity ?? [],
  }
}

function mapPayout(p: BackendPayoutRequest): PayoutRequest {
  return {
    id: String(p.id),
    seller_id: p.seller_id,
    seller_name: p.seller_name ?? undefined,
    seller_store: p.seller_store ?? undefined,
    seller_status: p.seller_status ?? undefined,
    amount: p.amount,
    method: p.payout_kind,
    details: p.payout_masked,
    status: p.status,
    admin_comment: p.admin_comment ?? null,
    external_txn_id: p.external_txn_id ?? null,
    created_at: p.created_at,
    taken_at: p.taken_at ?? null,
    paid_at: p.paid_at ?? null,
    rejected_at: p.rejected_at ?? null,
  }
}

/** Signals that mark the receipt as a (suspected) duplicate. */
const DUPLICATE_SIGNALS = new Set([
  'duplicate',
  'duplicate_qr',
  'file_hash_duplicate',
  'qr_raw_duplicate',
  'fn_fd_fp_duplicate',
  'historical_duplicate_fn_fd_fp',
  'historical_duplicate_file_hash',
  'cross_seller_duplicate',
])

/** Human-readable Russian label per known fraud-signal slug. */
const FRAUD_SIGNAL_LABEL: Record<string, string> = {
  multiple_receipts_detected: 'В одной загрузке обнаружено несколько разных чеков',
  file_hash_duplicate: 'Дубль файла — такое изображение уже загружалось',
  qr_raw_duplicate: 'Дубль QR-кода — этот чек уже загружался',
  fn_fd_fp_duplicate: 'Дубль по ФН / ФД / ФП — чек уже загружался',
  historical_duplicate_fn_fd_fp: 'Дубль по ФН / ФД / ФП — чек уже загружался',
  historical_duplicate_file_hash: 'Дубль файла — идентичное изображение уже загружалось',
  cross_seller_duplicate: 'Дубль между продавцами — этот чек уже загрузил другой продавец',
  demo_mode: 'Демо-режим: проверка ФНС/ОFD не выполнялась',
  receipt_too_old: 'Чек слишком старый — вне допустимого периода',
  qr_ofd_sum_mismatch: 'Сумма из QR не совпала с данными ОФД',
  no_sku_match: 'Не удалось сопоставить товары из чека',
  pipeline_enqueue_failed: 'Автоматическая обработка не запустилась — требуется ручная проверка',
}

function formatRub(kop: unknown): string | null {
  if (typeof kop !== 'number' || !Number.isFinite(kop)) return null
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 2,
  }).format(kop / 100)
}

/** Stringify backend `details` into a readable Russian sentence. */
function fraudDetailsText(slug: string, raw: BackendFraudSignal): string {
  const base = FRAUD_SIGNAL_LABEL[slug]
  const d = raw.details
  if (slug === 'qr_ofd_sum_mismatch' && d && typeof d === 'object') {
    const qr = formatRub((d as Record<string, unknown>)['qr_sum_kop'])
    const ofd = formatRub((d as Record<string, unknown>)['ofd_sum_kop'])
    if (qr && ofd) return `${base}: QR ${qr}, ОФД ${ofd}`
  }
  if (slug === 'receipt_too_old' && d && typeof d === 'object') {
    const details = d as Record<string, unknown>
    const age = details['age_days']
    const max = details['max_age_days']
    if (typeof age === 'number' && typeof max === 'number') {
      return `${base}: ${age} дн. при лимите ${max} дн.`
    }
  }
  // Backend may still send English/debug text in details. Prefer the curated
  // Russian label for known slugs; details stay available in DB/audit logs.
  if (typeof d === 'string' && d.trim()) return base ?? d
  if (base) return base
  if (d && typeof d === 'object') return JSON.stringify(d)
  return slug
}

/** Pull distinct {fn,fd,fp} identities from a `multiple_receipts_detected` signal. */
function identitiesFromSignal(s: BackendFraudSignal): FiscalIdentity[] {
  const d = s.details
  if (!d || typeof d !== 'object') return []
  const identities = (d as { identities?: unknown }).identities
  if (!Array.isArray(identities)) return []
  return identities
    .filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
    .map((it) => ({
      fn: typeof it['fn'] === 'string' ? it['fn'] : undefined,
      fd: typeof it['fd'] === 'string' ? it['fd'] : undefined,
      fp: typeof it['fp'] === 'string' ? it['fp'] : undefined,
    }))
}

/** Collect every extraction warning across all positions in ocr_raw. */
function extractionWarnings(ocr: BackendOcrRaw | null | undefined): string[] {
  const label: Record<string, string> = {
    file_unreadable: 'Файл не удалось прочитать',
    pdf_not_rasterized: 'PDF не удалось преобразовать в изображение',
    no_qr_found: 'QR-код не найден',
    low_confidence: 'Низкая уверенность распознавания',
  }
  const evidence = ocr?.extraction_evidence
  if (!evidence) return []
  const out: string[] = []
  for (const ev of Object.values(evidence)) {
    if (ev?.warnings) {
      out.push(...ev.warnings.filter((w): w is string => typeof w === 'string').map((w) => label[w] ?? w))
    }
  }
  return out
}

function mapAttachments(r: BackendReceipt): Attachment[] {
  const raw = r.attachments ?? []
  const mapped = raw.map((a) => ({
    id: a.id,
    position: a.position,
    kind: a.kind,
    mime_type: a.mime_type,
    url: a.url ?? null,
  }))
  // Stable order by position; tie-break on id so the sort is deterministic.
  mapped.sort((a, b) => (a.position - b.position) || (a.id - b.id))
  // Legacy single-file fallback: synthesise one image attachment from file_url
  // for older receipts that predate the multi-file pipeline.
  if (mapped.length === 0 && r.file_url) {
    return [{ id: 0, position: 0, kind: 'image', mime_type: 'image/*', url: r.file_url }]
  }
  return mapped
}

function mapAdminReceipt(r: BackendReceipt): AdminReceipt {
  const signals = r.fraud_signals ?? []
  // Duplicate label inferred from fraud signals (backend uses `signal` field,
  // not `type`). Severity is currently advisory only.
  const dup = signals.find((s) => DUPLICATE_SIGNALS.has(s.signal))
  const multiple = signals.find((s) => s.signal === 'multiple_receipts_detected')

  const fraud_signal: AdminFraudSignal[] = signals.map((s) => ({
    type: s.signal,
    severity: s.severity,
    details: fraudDetailsText(s.signal, s),
    duplicate_of_id: s.duplicate_of_id,
  }))

  // Distinct fiscal identities: prefer the multiple-receipts signal payload,
  // fall back to ocr_raw.detected_identities.
  const detected_identities: FiscalIdentity[] = multiple
    ? identitiesFromSignal(multiple)
    : (r.ocr_raw?.detected_identities ?? [])
        .map((it) => ({
          fn: it.fn ?? undefined,
          fd: it.fd ?? undefined,
          fp: it.fp ?? undefined,
        }))

  const attachments = mapAttachments(r)
  const warnings = extractionWarnings(r.ocr_raw)

  return {
    id: String(r.id),
    seller_id: r.seller_id,
    seller_name: r.seller_name ?? undefined,
    seller_store: r.seller_store ?? undefined,
    status: r.status,
    shop_name: r.shop_name ?? undefined,
    shop_address: r.shop_address ?? undefined,
    amount: r.total_sum ?? undefined,
    purchase_date: r.purchase_date ?? undefined,
    bonus_amount: r.bonus_amount,
    rejection_reason: r.rejection_reason ?? undefined,
    rejection_code: r.rejection_code ?? undefined,
    file_url: r.file_url ?? attachments[0]?.url ?? undefined,
    attachments,
    created_at: r.created_at,
    updated_at: r.updated_at ?? undefined,
    items: r.items?.map((it) => ({
      name: it.raw_name ?? it.name ?? '—',
      price: it.price,
      qty: it.qty,
    })),
    fn: r.fn ?? undefined,
    fd: r.fd ?? undefined,
    fp: r.fp ?? undefined,
    fraud_signal: fraud_signal.length ? fraud_signal : undefined,
    detected_identities: detected_identities.length ? detected_identities : undefined,
    extraction_warnings: warnings.length ? warnings : undefined,
    duplicate_status: dup ? 'danger' : 'ok',
    duplicate_label: dup ? 'Возможный дубль' : 'Уникален',
    source: r.source ?? undefined,
    verification_status: r.verification_status,
    verification_attempts: r.verification_attempts,
    next_verification_at: r.next_verification_at ?? undefined,
    verified_at: r.verified_at ?? undefined,
    verified_by: r.verified_by ?? undefined,
  }
}

function mapPagedSellers(p: PaginatedResponse<BackendSeller>): PaginatedResponse<AdminSellerRow> {
  return { ...p, items: p.items.map(mapAdminSeller) }
}

function mapPagedPayouts(p: PaginatedResponse<BackendPayoutRequest>): PaginatedResponse<PayoutRequest> {
  return { ...p, items: p.items.map(mapPayout) }
}

// ---- Receipt admin endpoints ----

interface BackendPagedReceipts {
  items: BackendReceipt[]
  total: number
  page: number
  limit: number
}

/**
 * Admin receipt list — server-side paginated and filtered.
 * Mirrors the same PagedResponse shape used by /bonus-transactions and /payout-requests.
 */
export const getAdminReceipts = async (
  filters: AdminReceiptsFilters = {},
): Promise<PaginatedResponse<AdminReceipt>> => {
  const params: Record<string, string | number> = {}
  if (filters.status?.length) params['status'] = filters.status.join(',')
  if (filters.seller_id != null) params['seller_id'] = filters.seller_id
  if (filters.from) params['from'] = filters.from
  if (filters.to) params['to'] = filters.to
  if (filters.order) params['order'] = filters.order
  const page = filters.page ?? 1
  const limit = filters.limit ?? 50
  params['page'] = page
  params['limit'] = limit

  const raw = await api
    .get<BackendPagedReceipts>('/receipts', { params })
    .then((r) => r.data)

  return {
    items: raw.items.map(mapAdminReceipt),
    total: raw.total,
    page: raw.page,
    limit: raw.limit,
    has_more: raw.page * raw.limit < raw.total,
  }
}

// All three endpoints accept a `{ comment }` body (Pydantic ReceiptReviewAction).
// Sending no body returns 422 — same regression class as the payout fix.
export const approveReceipt = (id: string, payload: ReceiptReviewActionPayload = {}) =>
  api.post<void>(`/receipts/${id}/approve`, {
    comment: payload.comment ?? null,
    bonus_amount: payload.bonusAmountKopecks ?? null,
  }).then((r) => r.data)

export const rejectReceipt = (id: string, comment?: string) =>
  api.post<void>(`/receipts/${id}/reject`, { comment: comment ?? null }).then((r) => r.data)

export const reviseReceipt = (id: string, comment: string) =>
  api.post<void>(`/receipts/${id}/revise`, { comment }).then((r) => r.data)

/** A6 soft-delete: hide a processed receipt (Отклонён / Выплачен). */
/** Soft-delete; an approved / paid out receipt gives its bonus back — reason required. */
export const deleteReceipt = (id: string, reason?: string) =>
  api.delete<void>(`/receipts/${id}`, reason ? { data: { reason } } : undefined).then((r) => r.data)

// ---- Payout admin endpoints ----

export const getAdminPayouts = (filters: AdminPayoutsFilters = {}) => {
  const params: Record<string, string | number> = {}
  if (filters.status) params['status'] = filters.status
  if (filters.page != null) params['page'] = filters.page
  if (filters.limit != null) params['limit'] = filters.limit
  if (filters.search) params['search'] = filters.search
  if (filters.order) params['order'] = filters.order
  return api
    .get<PaginatedResponse<BackendPayoutRequest>>('/payout-requests', { params })
    .then((r) => mapPagedPayouts(r.data))
}

export interface PayoutStatusTotal { count: number; amount: number }
/** Totals over ALL requests matching the filters — computed in the DB, not from a page. */
export interface PayoutSummary {
  new: PayoutStatusTotal
  in_progress: PayoutStatusTotal
  paid: PayoutStatusTotal
  rejected: PayoutStatusTotal
  paid_this_month: PayoutStatusTotal
}

export const getPayoutSummary = (filters: Pick<AdminPayoutsFilters, 'search'> = {}) =>
  api
    .get<PayoutSummary>('/payout-requests/summary', { params: filters.search ? { search: filters.search } : {} })
    .then((r) => r.data)

/** A receipt covered by a payout (BRD В-8-A). */
export interface PayoutCoverage {
  receipt_id: number
  amount: number
  bonus_amount: number
  receipt_status: string
  purchase_date: string | null
  total_sum: number | null
}

export const getPayoutReceipts = (id: string) =>
  api.get<PayoutCoverage[]>(`/payout-requests/${id}/receipts`).then((r) => r.data)

export const takePayoutRequest = (id: string) =>
  api.post<BackendPayoutRequest>(`/payout-requests/${id}/take`).then((r) => mapPayout(r.data))

export const approvePayoutRequest = (id: string, externalTxnId?: string) =>
  api.post<BackendPayoutRequest>(`/payout-requests/${id}/approve`, {
    external_txn_id: externalTxnId?.trim() || null,
  }).then((r) => mapPayout(r.data))

/** Rejection reason is required and shown to the seller. */
export const rejectPayoutRequest = (id: string, reason: string) =>
  api.post<BackendPayoutRequest>(`/payout-requests/${id}/reject`, {
    admin_comment: reason,
  }).then((r) => mapPayout(r.data))

// ---- Seller admin endpoints ----

export const getAdminSellers = (filters: AdminSellersFilters = {}) => {
  const params: Record<string, string | number | boolean> = {}
  if (filters.status) params['status'] = filters.status
  if (filters.page != null) params['page'] = filters.page
  if (filters.limit != null) params['limit'] = filters.limit
  if (filters.search) params['search'] = filters.search
  if (filters.sort) params['sort'] = filters.sort
  if (filters.risk) params['risk'] = filters.risk
  if (filters.city) params['city'] = filters.city
  if (filters.has_on_review != null) params['has_on_review'] = filters.has_on_review
  return api
    .get<PaginatedResponse<BackendSeller>>('/sellers', { params })
    .then((r) => mapPagedSellers(r.data))
}

/** GET /sellers/{telegram_id} — profile, balance breakdown, stats, risk, weekly activity. */
export const getAdminSellerById = (telegram_id: number): Promise<AdminSellerDetail> =>
  api.get<BackendSellerDetail>(`/sellers/${telegram_id}`).then((r) => mapAdminSellerDetail(r.data))

export const getAdminSeller = getAdminSellerById

// ---- Analytics ----

/** GET /analytics/dashboard — every number aggregated in SQL over the whole DB. */
export interface AdminDashboardResponse {
  sellers_total: number
  sellers_active: number
  receipts_total: number
  receipts_on_review: number
  payouts_pending: number
  payouts_pending_amount: number
  payouts_paid_month: number
  payouts_paid_month_amount: number
  avg_check: number
  daily_receipts: Array<{ day: string; receipts: number }>
  top_sellers: Array<{
    telegram_id: number
    name: string
    city: string | null
    receipts_total: number
    receipts_approved: number
    sales: number
    paid: number
  }>
  top_products: Array<{ name: string; count: number }>
  generated_at: string
}

export const getAdminDashboard = (): Promise<AdminDashboardResponse> =>
  api.get<AdminDashboardResponse>('/analytics/dashboard').then((r) => r.data)

// ---- New receipt / seller action endpoints ----

/**
 * PATCH /receipts/{id}/bonus — override the bonus amount for a receipt.
 * @param id  Receipt id (string)
 * @param amount  Amount in kopecks (integer)
 */
export const editReceiptBonus = (id: string, amount: number, reason?: string): Promise<Receipt> =>
  api
    .patch<BackendReceipt>(`/receipts/${id}/bonus`, { bonus_amount: Math.round(amount), ...(reason ? { reason } : {}) })
    .then((r) => {
      const mapped = mapAdminReceipt(r.data)
      // Strip admin-only fields to satisfy the Receipt return type
      const { seller_name: _sn, seller_store: _ss, fraud_signal: _fs, rejection_reason: _rr, fn: _fn, fd: _fd, fp: _fp, shop_address: _sa, duplicate_status: _ds, duplicate_label: _dl, ...receipt } = mapped
      return receipt as Receipt
    })

/**
 * POST /receipts/{id}/comment — attach a text comment to a receipt.
 * @param id   Receipt id (string)
 * @param text Comment text (1–2000 chars)
 */
export const addReceiptComment = (id: string, text: string): Promise<Receipt> =>
  api
    .post<BackendReceipt>(`/receipts/${id}/comment`, { text })
    .then((r) => {
      const mapped = mapAdminReceipt(r.data)
      const { seller_name: _sn, seller_store: _ss, fraud_signal: _fs, rejection_reason: _rr, fn: _fn, fd: _fd, fp: _fp, shop_address: _sa, duplicate_status: _ds, duplicate_label: _dl, ...receipt } = mapped
      return receipt as Receipt
    })

/**
 * POST /sellers/{telegram_id}/block — block a seller with an optional reason.
 * New endpoint added by the backend parallel agent.
 */
export const blockSeller = (telegram_id: string, reason: string | null): Promise<AdminSeller> =>
  api
    .post<BackendSeller>(`/sellers/${telegram_id}/block`, { reason: reason ?? null })
    .then((r) => mapAdminSeller(r.data))

/**
 * POST /sellers/{telegram_id}/unblock — remove a block on a seller.
 * New endpoint added by the backend parallel agent.
 */
export const unblockSeller = (telegram_id: string): Promise<AdminSeller> =>
  api
    .post<BackendSeller>(`/sellers/${telegram_id}/unblock`, {})
    .then((r) => mapAdminSeller(r.data))

// ---- Receipt journey (docs/design/RECEIPT-JOURNEY.md) ----

/** GET /receipts/{id}/journey — every step from intake to the decision, with each provider check. */
export const getReceiptJourney = (id: string): Promise<ReceiptJourney> =>
  api.get<ReceiptJourney>(`/receipts/${id}/journey`).then((r) => r.data)

/** POST /receipts/{id}/verify — a new check round now, or only at `provider`. */
export const verifyReceiptNow = (id: string, provider?: string): Promise<ReceiptJourney> =>
  api.post<ReceiptJourney>(`/receipts/${id}/verify`, provider ? { provider } : {}).then((r) => r.data)
