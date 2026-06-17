import { api } from './client'

/** Product / SKU — UC-02. Fields map to the spec:
 *  код маркировки → code · название → name · категория → category · сумма выплат → default_bonus. */
export interface Sku {
  id: number
  brand_id: number
  code: string
  name: string
  category?: string | null
  default_bonus: number
  is_active: boolean
  created_at?: string
}

export interface CreateSkuPayload {
  brand_id: number
  code: string
  name: string
  category?: string
  default_bonus: number
}

export interface ListSkusParams {
  brand_id?: number
  category?: string
  q?: string
}

export const listSkus = (params: ListSkusParams = {}): Promise<Sku[]> =>
  api.get<Sku[]>('/skus', { params }).then((r) => r.data)

export const createSku = (payload: CreateSkuPayload): Promise<Sku> =>
  api.post<Sku>('/skus', payload).then((r) => r.data)

export const deleteSku = (id: number): Promise<void> =>
  api.delete(`/skus/${id}`).then(() => undefined)
