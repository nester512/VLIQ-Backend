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
}

export interface AdminPayoutsFilters {
  status?: string
  page?: number
  limit?: number
  search?: string
}

export interface AdminSellersFilters {
  status?: string
  page?: number
  limit?: number
  search?: string
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
}

export interface AdminSellerRow extends SellerProfile {
  receipts_total?: number
  receipts_approved?: number
  balance?: number
  registered_at?: string
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
}

interface BackendPayoutRequest {
  id: number
  seller_id: number
  seller_name?: string | null
  seller_store?: string | null
  brand_id: number
  amount: number
  payout_kind: PayoutMethod
  payout_masked: string
  status: 'new' | 'in_progress' | 'paid' | 'rejected'
  admin_comment?: string | null
  external_txn_id?: string | null
  created_at: string
  updated_at?: string | null
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
    registered_at: s.created_at,
  }
}

function mapPayout(p: BackendPayoutRequest): PayoutRequest {
  return {
    id: String(p.id),
    seller_id: p.seller_id,
    seller_name: p.seller_name ?? undefined,
    seller_store: p.seller_store ?? undefined,
    amount: p.amount,
    method: p.payout_kind,
    details: p.payout_masked,
    status: p.status,
    created_at: p.created_at,
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
export const deleteReceipt = (id: string) =>
  api.delete<void>(`/receipts/${id}`).then((r) => r.data)

// ---- Payout admin endpoints ----

export const getAdminPayouts = (filters: AdminPayoutsFilters = {}) => {
  const params: Record<string, string | number> = {}
  if (filters.status) params['status'] = filters.status
  if (filters.page != null) params['page'] = filters.page
  if (filters.limit != null) params['limit'] = filters.limit
  if (filters.search) params['search'] = filters.search
  return api
    .get<PaginatedResponse<BackendPayoutRequest>>('/payout-requests', { params })
    .then((r) => mapPagedPayouts(r.data))
}

export const approvePayoutRequest = (id: string, externalTxnId?: string) =>
  api.post<void>(`/payout-requests/${id}/approve`, {
    external_txn_id: externalTxnId ?? null,
  }).then((r) => r.data)

export const rejectPayoutRequest = (id: string, adminComment?: string) =>
  api.post<void>(`/payout-requests/${id}/reject`, {
    admin_comment: adminComment ?? null,
  }).then((r) => r.data)

// ---- Seller admin endpoints ----

export const getAdminSellers = (filters: AdminSellersFilters = {}) => {
  const params: Record<string, string | number> = {}
  if (filters.status) params['status'] = filters.status
  if (filters.page != null) params['page'] = filters.page
  if (filters.limit != null) params['limit'] = filters.limit
  if (filters.search) params['search'] = filters.search
  return api
    .get<PaginatedResponse<BackendSeller>>('/sellers', { params })
    .then((r) => mapPagedSellers(r.data))
}

export const getAdminSeller = (telegram_id: number) =>
  api.get<BackendSeller>(`/sellers/${telegram_id}`).then((r) => mapAdminSeller(r.data))

/** Fetch a single seller by telegram_id from the real GET /sellers/{telegram_id} endpoint. */
export const getAdminSellerById = (telegram_id: number): Promise<AdminSellerRow> =>
  api.get<BackendSeller>(`/sellers/${telegram_id}`).then((r) => mapAdminSeller(r.data))

/**
 * Toggle seller status via PATCH /sellers/{id}. The backend doesn't expose a
 * dedicated /block endpoint — but the generic update accepts the `status`
 * field (admin role required). `blocked` <-> `active` covers both directions.
 */
export const setSellerStatus = (telegram_id: number, status: 'active' | 'blocked' | 'pending', blockReason?: string) =>
  api
    .patch<BackendSeller>(`/sellers/${telegram_id}`, {
      status,
      ...(status === 'blocked' && blockReason ? { block_reason: blockReason } : {}),
    })
    .then((r) => mapAdminSeller(r.data))

// ---- New receipt / seller action endpoints ----

/**
 * PATCH /receipts/{id}/bonus — override the bonus amount for a receipt.
 * @param id  Receipt id (string)
 * @param amount  Amount in kopecks (integer)
 */
export const editReceiptBonus = (id: string, amount: number): Promise<Receipt> =>
  api
    .patch<BackendReceipt>(`/receipts/${id}/bonus`, { bonus_amount: Math.round(amount) })
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
