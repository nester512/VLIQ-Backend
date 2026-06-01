import { api } from './client'
import type { Notification } from '../types/models'

interface BackendNotification {
  id: number
  seller_id: number
  type: string
  payload: { title?: string; body?: string; [k: string]: unknown }
  read_at: string | null
  created_at: string
}

interface PagedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

function fallbackTitle(type: string): string {
  switch (type) {
    case 'receipt_approved': return 'Чек одобрен'
    case 'receipt_rejected': return 'Чек отклонён'
    case 'bonus_accrued':    return 'Бонус начислен'
    case 'payout_sent':      return 'Выплата отправлена'
    case 'promo_started':    return 'Новая акция'
    case 'promo_ending':     return 'Акция заканчивается'
    default:                  return 'Уведомление'
  }
}

function mapNotification(n: BackendNotification): Notification {
  return {
    id: String(n.id),
    seller_id: n.seller_id,
    title: n.payload?.title ?? fallbackTitle(n.type),
    body:  n.payload?.body ?? '',
    read:  n.read_at !== null,
    created_at: n.created_at,
  }
}

export const listNotifications = (unread?: boolean) =>
  api
    .get<PagedResponse<BackendNotification>>('/notifications', {
      params: unread !== undefined ? { unread } : undefined,
    })
    .then((r) => r.data.items.map(mapNotification))

/**
 * Backend returns 204 No Content (no body). We don't try to map the response
 * — the calling hook performs an optimistic cache update + invalidation
 * which refetches the full list with the fresh `read_at` timestamp.
 */
export const markRead = (id: string): Promise<void> =>
  api.post<void>(`/notifications/${id}/read`).then(() => undefined)
