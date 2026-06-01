// Domain model types for VLIQ

export type ReceiptStatus =
  | 'pending'
  | 'ocr_in_progress'
  | 'on_review'
  | 'approved'
  | 'rejected'
  | 'needs_revision'
  | 'paid_out'

export interface Receipt {
  id: string
  seller_id: number
  status: ReceiptStatus
  shop_name?: string
  amount?: number
  bonus_amount?: number
  rejection_reason?: string
  created_at: string
  updated_at?: string
  items?: ReceiptItem[]
  file_url?: string
}

export interface ReceiptItem {
  name: string
  price: number
  qty?: number
}

export type TransactionType = 'bonus' | 'payout' | 'adjustment'

export interface BonusTransaction {
  id: string
  seller_id: number
  type: TransactionType
  amount: number
  description?: string
  receipt_id?: string
  created_at: string
}

export interface SellerBalance {
  available: number
  pending: number
  total_earned: number
  total_paid: number
  receipts_approved: number
  receipts_total: number
}

export type PayoutStatus = 'new' | 'in_progress' | 'paid' | 'rejected'
export type PayoutMethod = 'card' | 'sbp_phone' | 'sbp_bank'

export interface PayoutRequest {
  id: string
  seller_id: number
  amount: number
  method: PayoutMethod
  details?: string
  status: PayoutStatus
  created_at: string
}

export interface Promotion {
  id: string
  tag: string
  title: string
  description: string
  gradient: string
  active_until?: string
  participants?: number
  bonus_multiplier?: number
}

export interface Notification {
  id: string
  seller_id: number
  title: string
  body: string
  read: boolean
  created_at: string
}

export type SellerStatus = 'pending' | 'active' | 'blocked'

export interface SellerProfile {
  id: number
  telegram_id?: number
  brand_id?: number
  first_name?: string
  last_name?: string
  phone?: string
  city?: string
  store_name?: string
  store_address?: string
  position?: string
  payout_method?: PayoutMethod
  payout_details?: string
  is_active: boolean
  /** Lifecycle status from backend — `pending` means RegPage isn't completed yet. */
  status?: SellerStatus
}
