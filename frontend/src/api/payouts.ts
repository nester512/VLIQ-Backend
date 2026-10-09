import { api } from './client'
import type { PayoutRequest, PayoutMethod } from '../types/models'

export interface CreatePayoutPayload {
  amount: number
  method: PayoutMethod
  /** Phone for СБП, entered in the form on every request (В-5-A). */
  phone: string
}

interface BackendCreatePayout {
  amount: number
  payout_kind: PayoutMethod
  phone: string
}

interface BackendPayoutRequestRead {
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
  taken_at?: string | null
  paid_at?: string | null
  rejected_at?: string | null
}

function map(r: BackendPayoutRequestRead): PayoutRequest {
  return {
    id: String(r.id),
    seller_id: r.seller_id,
    amount: r.amount,
    method: r.payout_kind,
    details: r.payout_masked,
    status: r.status,
    admin_comment: r.admin_comment ?? null,
    external_txn_id: r.external_txn_id ?? null,
    created_at: r.created_at,
    taken_at: r.taken_at ?? null,
    paid_at: r.paid_at ?? null,
    rejected_at: r.rejected_at ?? null,
  }
}

/** S5.5 — the seller's own payout requests with statuses, newest first. */
export const getMyPayoutRequests = (): Promise<PayoutRequest[]> =>
  api.get<BackendPayoutRequestRead[]>('/payout-requests/me').then((r) => r.data.map(map))

export const createPayoutRequest = (payload: CreatePayoutPayload, idempotencyKey: string) => {
  const body: BackendCreatePayout = { amount: payload.amount, payout_kind: payload.method, phone: payload.phone }
  return api
    .post<BackendPayoutRequestRead>('/payout-requests', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((r) => map(r.data))
}
