import { api } from './client'
import type { BonusTransaction, TransactionType } from '../types/models'

interface BackendBonusTx {
  id: number
  seller_id: number
  brand_id: number
  amount: number
  kind: 'accrual_receipt' | 'accrual_promo' | 'accrual_manual' | 'payout_hold' | 'payout_completed' | 'payout_reverted' | 'correction'
  source_type: string
  source_id: number | null
  reason: string | null
  created_at: string
}

interface PagedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

function mapKind(k: BackendBonusTx['kind']): TransactionType {
  if (k.startsWith('payout_')) return 'payout'
  if (k === 'correction') return 'adjustment'
  return 'bonus'
}

function defaultDescription(k: BackendBonusTx['kind']): string {
  switch (k) {
    case 'accrual_receipt':  return 'Бонус за чек'
    case 'accrual_promo':    return 'Бонус по акции'
    case 'accrual_manual':   return 'Ручное начисление'
    case 'payout_hold':      return 'Резерв на выплату'
    case 'payout_completed': return 'Выплата'
    case 'payout_reverted':  return 'Возврат резерва'
    case 'correction':       return 'Корректировка'
  }
}

function map(tx: BackendBonusTx): BonusTransaction {
  return {
    id: String(tx.id),
    seller_id: tx.seller_id,
    type: mapKind(tx.kind),
    amount: tx.amount,
    description: tx.reason ?? defaultDescription(tx.kind),
    receipt_id: tx.source_type === 'receipt' && tx.source_id ? String(tx.source_id) : undefined,
    created_at: tx.created_at,
  }
}

/**
 * Seller-scoped on the backend: `validate_token_dependency` + role=seller
 * filter clamps results to `token.user_id` automatically. Returns a flat list
 * for callers (we drop the paging envelope).
 */
export const listMyBonusTransactions = (limit = 50) =>
  api
    .get<PagedResponse<BackendBonusTx>>('/bonus-transactions', { params: { limit } })
    .then((r) => r.data.items.map(map))
