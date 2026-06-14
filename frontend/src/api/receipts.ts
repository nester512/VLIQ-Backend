import { api } from './client'
import type { Receipt, ReceiptStatus } from '../types/models'

export interface ReceiptsFilters {
  status?: string
  limit?: number
  /** 1-based page index — translated to `page` on the wire. */
  page?: number
}

// ---------------------------------------------------------------------------
// Backend wire types
// ---------------------------------------------------------------------------

interface BackendReceiptItem {
  /** Backend uses `raw_name`; older mocks send `name` — accept either. */
  raw_name?: string
  name?: string
  price: number
  qty?: number
}

interface BackendReceipt {
  id: number
  seller_id: number
  brand_id?: number
  status: ReceiptStatus
  bonus_amount?: number
  rejection_reason?: string | null
  file_url?: string
  file_kind?: string
  shop_name?: string | null
  shop_inn?: string | null
  total_sum?: number | null
  purchase_date?: string | null
  items?: BackendReceiptItem[]
  created_at: string
  updated_at?: string | null
}

interface PagedResponse<T> {
  items: T[]
  total: number
  page: number
  limit: number
  has_more: boolean
}

interface BackendReceiptUpload { receipt_id: number }
interface BackendReceiptStatus {
  // Backend uses `receipt_id` alias `id` via populate_by_name — accept either.
  id?: number
  receipt_id?: number
  status: ReceiptStatus
  bonus_amount?: number
  rejection_reason?: string | null
}

export interface PresignedUploadResponse {
  upload_url: string
  fields: Record<string, string>
  storage_uri: string
  expires_in: number
}

// TODO: unit test — mock BackendReceipt with total_sum, bonus_amount, items[{raw_name,qty,price}]
// and assert the mapped Receipt has amount, bonus_amount, items[{name,qty,price}] with correct values.
// e.g. mapReceipt({ id:1, seller_id:2, status:'approved', total_sum:1500, bonus_amount:150,
//   items:[{raw_name:'Молоко',price:1500,qty:1}], created_at:'2024-01-01T00:00:00Z' })
// should return { amount:1500, bonus_amount:150, items:[{name:'Молоко',price:1500,qty:1}] }
function mapReceipt(r: BackendReceipt): Receipt {
  return {
    id: String(r.id),
    seller_id: r.seller_id,
    status: r.status,
    shop_name: r.shop_name ?? undefined,
    amount: r.total_sum ?? undefined,
    bonus_amount: r.bonus_amount,
    rejection_reason: r.rejection_reason ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at ?? undefined,
    items: r.items?.map((it) => ({
      name: it.raw_name ?? it.name ?? '—',
      price: it.price,
      qty: it.qty,
    })),
    file_url: r.file_url,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Seller-facing list — hits the seller-scoped endpoint and flattens the
 * paged response so callers can treat it as a plain array.
 */
export const getMyReceipts = (filters: ReceiptsFilters = {}): Promise<Receipt[]> => {
  const params: Record<string, string | number> = {}
  if (filters.status) params['status'] = filters.status
  if (filters.limit != null) params['limit'] = filters.limit
  if (filters.page != null) params['page'] = filters.page
  return api
    .get<PagedResponse<BackendReceipt>>('/sellers/me/receipts', { params })
    .then((r) => r.data.items.map(mapReceipt))
}

export const getReceipt = (id: string) =>
  api.get<BackendReceipt>(`/receipts/${id}`).then((r) => mapReceipt(r.data))

export const getReceiptStatus = (id: string): Promise<Receipt> =>
  api
    .get<BackendReceiptStatus>(`/receipts/${id}/status`)
    .then((r) => ({
      id: String(r.data.id ?? r.data.receipt_id ?? id),
      seller_id: 0,                          // not surfaced by /status; not used by StatusPage
      status: r.data.status,
      bonus_amount: r.data.bonus_amount,
      rejection_reason: r.data.rejection_reason ?? undefined,
      // /status doesn't carry the created_at — the page falls back gracefully.
      created_at: new Date().toISOString(),
    }))

/**
 * Multipart upload — caller passes the file and the active brand_id (backend
 * requires it on `POST /receipts/upload`). Returns just the new id as a
 * string to slot back into the domain model.
 */
export const uploadReceipt = (file: File, brandId: number): Promise<{ id: string }> => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('brand_id', String(brandId))
  // The shared axios instance defaults Content-Type to application/json. Axios
  // v1's transformRequest, seeing a JSON content-type on a FormData payload,
  // SERIALIZES the FormData to JSON — so the multipart body never reaches the
  // server and FastAPI returns 422 (file/brand_id "field required"). Null out
  // the header so the browser sets `multipart/form-data; boundary=…` itself.
  return api
    .post<BackendReceiptUpload>('/receipts/upload', formData, {
      headers: { 'Content-Type': null },
    })
    .then((r) => ({ id: String(r.data.receipt_id) }))
}

/**
 * Submit a raw QR string scanned by the Telegram in-app QR reader.
 * Uses POST /receipts/qr-payload instead of wrapping the string in a file.
 */
export const submitQrPayload = (qrRaw: string, brandId: number): Promise<{ id: string }> =>
  api
    .post<BackendReceiptUpload>('/receipts/qr-payload', { qr_raw: qrRaw, brand_id: brandId })
    .then((r) => ({ id: String(r.data.receipt_id) }))

/**
 * Get a presigned S3 POST URL for direct browser-to-S3 upload.
 * Call this first, then upload the file directly to the returned upload_url,
 * then call finalizeUpload with the storage_uri.
 */
export const getUploadUrl = (mime: string): Promise<PresignedUploadResponse> =>
  api
    .post<PresignedUploadResponse>('/receipts/upload-url', { mime })
    .then((r) => r.data)

/**
 * Finalize a direct-to-S3 upload — notify the backend of the uploaded file's
 * storage URI so it can create the receipt row and enqueue OCR processing.
 */
export const finalizeUpload = (
  storageUri: string,
  mime: string,
  brandId: number,
): Promise<{ id: string }> =>
  api
    .post<BackendReceiptUpload>('/receipts/finalize', {
      storage_uri: storageUri,
      mime,
      brand_id: brandId,
    })
    .then((r) => ({ id: String(r.data.receipt_id) }))
