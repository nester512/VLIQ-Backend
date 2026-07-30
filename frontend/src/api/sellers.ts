import { api } from './client'
import type { SellerProfile, SellerBalance, PayoutMethod } from '../types/models'

// ---------------------------------------------------------------------------
// Backend wire types — what the API actually returns.
//
// The backend evolved its schema (outlet_*, payout_kind, status) independently
// from the frontend domain model (store_*, payout_method, is_active). Rather
// than churn either side, the mapping is anchored here so the rest of the app
// keeps speaking the domain dialect.
// ---------------------------------------------------------------------------

interface BackendSellerRead {
  telegram_id: number
  brand_id: number
  phone_e164: string
  first_name?: string | null
  last_name?: string | null
  city?: string | null
  region?: string | null
  outlet_name?: string | null
  outlet_address?: string | null
  outlet_count?: number | null
  outlet_chain?: string | null
  outlet_inn?: string | null
  position?: string | null
  status: 'pending' | 'active' | 'blocked'
  block_reason?: string | null
  payout_kind?: PayoutMethod | null
  payout_masked?: string | null
  created_at: string
  updated_at?: string | null
}

interface BackendBalanceRead {
  available: number
  on_hold: number
  total_accrued: number
  total_paid_out: number
}

function mapSeller(s: BackendSellerRead): SellerProfile {
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
    store_count: s.outlet_count ?? undefined,
    position: s.position ?? undefined,
    payout_method: s.payout_kind ?? undefined,
    payout_details: s.payout_masked ?? undefined,
    is_active: s.status === 'active',
    status: s.status,
  }
}

function mapBalance(b: BackendBalanceRead): SellerBalance {
  return {
    available:        b.available ?? 0,
    pending:          b.on_hold ?? 0,
    total_earned:     b.total_accrued ?? 0,
    total_paid:       b.total_paid_out ?? 0,
    receipts_approved: 0, // backend doesn't expose this on balance; pages derive it
    receipts_total:    0,
  }
}

// ---------------------------------------------------------------------------
// Reverse mapping for PATCH /sellers/me — domain → backend SellerUpdate.
// ---------------------------------------------------------------------------

interface BackendSellerUpdate {
  phone_e164?: string
  first_name?: string
  last_name?: string
  city?: string
  outlet_name?: string
  outlet_address?: string
  outlet_count?: number
  position?: string
  payout_kind?: PayoutMethod
  payout_masked?: string
  payout_account_raw?: string
}

export interface SellerUpdatePayload extends Partial<SellerProfile> {
  payout_account_raw?: string
}

function mapSellerUpdate(p: SellerUpdatePayload): BackendSellerUpdate {
  const out: BackendSellerUpdate = {}
  if (p.phone !== undefined)              out.phone_e164         = p.phone
  if (p.first_name !== undefined)         out.first_name         = p.first_name
  if (p.last_name !== undefined)          out.last_name          = p.last_name
  if (p.city !== undefined)               out.city               = p.city
  if (p.store_name !== undefined)         out.outlet_name        = p.store_name
  if (p.store_address !== undefined)      out.outlet_address     = p.store_address
  if (p.store_count !== undefined)        out.outlet_count       = p.store_count
  if (p.position !== undefined)           out.position           = p.position
  if (p.payout_method !== undefined)      out.payout_kind        = p.payout_method
  if (p.payout_details !== undefined)     out.payout_masked      = p.payout_details
  if (p.payout_account_raw !== undefined) out.payout_account_raw = p.payout_account_raw
  return out
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const getMe = () =>
  api.get<BackendSellerRead>('/sellers/me').then((r) => mapSeller(r.data))

export const updateMe = (payload: SellerUpdatePayload) =>
  api.patch<BackendSellerRead>('/sellers/me', mapSellerUpdate(payload)).then((r) => mapSeller(r.data))

export const getMyBalance = () =>
  api.get<BackendBalanceRead>('/sellers/me/balance').then((r) => mapBalance(r.data))

export const getMyNotifications = () =>
  api.get('/sellers/me/notifications').then((r) => r.data)
