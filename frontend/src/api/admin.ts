import { api } from './client'
import type {
  Receipt, PayoutRequest, SellerProfile, PayoutMethod, ReceiptStatus,
} from '../types/models'

// ---- Filters ----

export type ReviewAction = 'approve' | 'reject' | 'revise'

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

export interface AdminReceipt extends Receipt {
  seller_name?: string
  seller_store?: string
  fraud_signal?: Array<{ type: string; details: string }>
  rejection_reason?: string
  fn?: string
  fd?: string
  fp?: string
  shop_address?: string
  duplicate_status?: 'ok' | 'warn' | 'danger'
  duplicate_label?: string
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

interface BackendReceipt {
  id: number
  seller_id: number
  seller_name?: string | null
  seller_store?: string | null
  brand_id?: number
  status: ReceiptStatus
  bonus_amount?: number
  rejection_reason?: string | null
  file_url?: string
  shop_name?: string | null
  shop_inn?: string | null
  total_sum?: number | null
  fn?: string | null
  fd?: string | null
  fp?: string | null
  items?: Array<{ raw_name?: string; name?: string; price: number; qty?: number }>
  // Backend ReceiptFraudSignal shape — `signal` not `type`, plus severity + duplicate_of_id.
  fraud_signals?: Array<{ signal: string; severity?: string; details?: Record<string, unknown> | string | null; duplicate_of_id?: number }>
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
    amount: p.amount,
    method: p.payout_kind,
    details: p.payout_masked,
    status: p.status,
    created_at: p.created_at,
  }
}

function mapAdminReceipt(r: BackendReceipt): AdminReceipt {
  // Duplicate label inferred from fraud signals (backend uses `signal` field,
  // not `type`). Severity is currently advisory only.
  const dup = r.fraud_signals?.find((s) => s.signal === 'duplicate' || s.signal === 'duplicate_qr')
  return {
    id: String(r.id),
    seller_id: r.seller_id,
    seller_name: r.seller_name ?? undefined,
    seller_store: r.seller_store ?? undefined,
    status: r.status,
    shop_name: r.shop_name ?? undefined,
    amount: r.total_sum ?? undefined,
    bonus_amount: r.bonus_amount,
    rejection_reason: r.rejection_reason ?? undefined,
    file_url: r.file_url,
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
    fraud_signal: r.fraud_signals?.map((s) => ({
      type: s.signal,
      details: typeof s.details === 'string' ? s.details : (s.details ? JSON.stringify(s.details) : ''),
    })),
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
export const approveReceipt = (id: string, comment?: string) =>
  api.post<void>(`/receipts/${id}/approve`, { comment: comment ?? null }).then((r) => r.data)

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
