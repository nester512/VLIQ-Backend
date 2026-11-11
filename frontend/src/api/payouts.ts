import { api } from './client'
import type { PayoutRequest, PayoutMethod } from '../types/models'
import type { SbpBank } from '../features/seller/payout/bankSearch'

export interface CreatePayoutPayload {
  amount: number
  method: PayoutMethod
  /** Phone for СБП, entered in the form on every request (В-5-A). */
  phone: string
  /** The bank the transfer goes to: an NSPK member id, or 'other' with the typed name. */
  bankId: string
  bankName?: string
}

interface BackendCreatePayout {
  amount: number
  payout_kind: PayoutMethod
  phone: string
  bank_id: string
  bank_name?: string
}

interface BackendPayoutRequestRead {
  id: number
  seller_id: number
  brand_id: number
  amount: number
  payout_kind: PayoutMethod
  payout_masked: string
  bank_id?: string | null
  bank_name?: string | null
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
    bank_id: r.bank_id ?? null,
    bank_name: r.bank_name ?? null,
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
  const body: BackendCreatePayout = {
    amount: payload.amount, payout_kind: payload.method, phone: payload.phone,
    bank_id: payload.bankId, ...(payload.bankName ? { bank_name: payload.bankName } : {}),
  }
  return api
    .post<BackendPayoutRequestRead>('/payout-requests', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    .then((r) => map(r.data))
}

/** UC-S7 — banks the SBP transfer can go to (NSPK list): popular first, then А–Я. */
export const getSbpBanks = (): Promise<SbpBank[]> =>
  api.get<SbpBank[]>('/payout-requests/sbp-banks').then((r) => r.data)
