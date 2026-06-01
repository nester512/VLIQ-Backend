import { api } from './client'
import type { PayoutRequest, PayoutMethod } from '../types/models'

export interface CreatePayoutPayload {
  amount: number
  method: PayoutMethod
  /** Masked destination (last 4 of card / phone). If absent, backend uses
   *  the value stored on the seller profile. */
  details?: string
}

interface BackendCreatePayout {
  amount: number
  payout_kind: PayoutMethod
  payout_masked?: string
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
  created_at: string
  updated_at?: string | null
}

function map(r: BackendPayoutRequestRead): PayoutRequest {
  return {
    id: String(r.id),
    seller_id: r.seller_id,
    amount: r.amount,
    method: r.payout_kind,
    details: r.payout_masked,
    status: r.status,
    created_at: r.created_at,
  }
}

export const createPayoutRequest = (payload: CreatePayoutPayload, idempotencyKey: string) => {
  const body: BackendCreatePayout = {
    amount: payload.amount,
    payout_kind: payload.method,
    ...(payload.details ? { payout_masked: payload.details } : {}),
  }
  return api
    .post<BackendPayoutRequestRead>('/payout-requests', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((r) => map(r.data))
}
