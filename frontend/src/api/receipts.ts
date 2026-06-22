import { api } from './client'
import type { Attachment, AttachmentKind, Receipt, ReceiptStatus } from '../types/models'

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

/** Mirrors backend `ReceiptAttachmentRead`. */
interface BackendAttachment {
  id: number
  position: number
  kind: AttachmentKind
  mime_type: string
  url?: string | null
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
  attachments?: BackendAttachment[]
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

/** 202 response from the batch `POST /receipts/upload`. */
interface BackendReceiptUpload {
  receipt_id: number
  status?: string
  message?: string
}
interface BackendReceiptStatus {
  // Backend uses `receipt_id` alias `id` via populate_by_name — accept either.
  id?: number
  receipt_id?: number
  status: ReceiptStatus
  bonus_amount?: number
  rejection_reason?: string | null
  rejection_code?: string | null
  /** Browser-viewable URL of the uploaded photo/file (null for inline-QR). */
  file_url?: string | null
  /** Ordered package attachments (preferred over the legacy single file_url). */
  attachments?: BackendAttachment[]
}

// TODO: unit test — mock BackendReceipt with total_sum, bonus_amount, items[{raw_name,qty,price}]
// and assert the mapped Receipt has amount, bonus_amount, items[{name,qty,price}] with correct values.
// e.g. mapReceipt({ id:1, seller_id:2, status:'approved', total_sum:1500, bonus_amount:150,
//   items:[{raw_name:'Молоко',price:1500,qty:1}], created_at:'2024-01-01T00:00:00Z' })
// should return { amount:1500, bonus_amount:150, items:[{name:'Молоко',price:1500,qty:1}] }
/** Map wire attachments to the shared domain type, preserving backend order. */
function mapAttachments(raw?: BackendAttachment[]): Attachment[] | undefined {
  if (!raw) return undefined
  return raw.map((a) => ({
    id: a.id,
    position: a.position,
    kind: a.kind,
    mime_type: a.mime_type,
    url: a.url ?? null,
  }))
}

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
    attachments: mapAttachments(r.attachments),
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
      rejection_code: r.data.rejection_code ?? undefined,
      attachments: mapAttachments(r.data.attachments),
      file_url: r.data.file_url ?? undefined,
      // /status doesn't carry the created_at — the page falls back gracefully.
      created_at: new Date().toISOString(),
    }))

export interface UploadReceiptPackageOptions {
  brandId: number
  /** Raw QR string from the Telegram in-app scanner (optional, additive). */
  scannedQr?: string
  /**
   * Stable client-generated id for this submission. A retry of the SAME
   * submission MUST reuse it so the backend returns the same receipt instead
   * of creating a duplicate.
   */
  idempotencyKey: string
  /** Called repeatedly during the upload with percentage 0-100. */
  onProgress?: (pct: number) => void
}

/**
 * Submit a single receipt package — 1..5 attachments (images and/or PDFs) plus
 * an optional scanned QR — as ONE multipart request to `POST /receipts/upload`.
 *
 * One submission = one Receipt: every file is sent under the repeated `files`
 * field in a single FormData, so the backend creates exactly one receipt (no
 * per-file loop, no duplicate). Returns the new receipt id as a string.
 */
export const uploadReceiptPackage = (
  files: File[],
  opts: UploadReceiptPackageOptions,
): Promise<{ id: string }> => {
  const formData = new FormData()
  // Repeat the `files` field for every attachment (FastAPI reads them as a list).
  for (const file of files) {
    formData.append('files', file)
  }
  formData.append('brand_id', String(opts.brandId))
  if (opts.scannedQr) {
    formData.append('scanned_qr', opts.scannedQr)
  }
  formData.append('idempotency_key', opts.idempotencyKey)

  // The shared axios instance defaults Content-Type to application/json. Axios
  // v1's transformRequest, seeing a JSON content-type on a FormData payload,
  // SERIALIZES the FormData to JSON — so the multipart body never reaches the
  // server and FastAPI returns 422. Null out the header so the browser sets
  // `multipart/form-data; boundary=…` itself.
  return api
    .post<BackendReceiptUpload>('/receipts/upload', formData, {
      headers: { 'Content-Type': null },
      onUploadProgress: opts.onProgress
        ? (e) => {
            const total = e.total ?? 0
            if (total > 0) {
              opts.onProgress?.(Math.round((e.loaded / total) * 100))
            }
          }
        : undefined,
    })
    .then((r) => ({ id: String(r.data.receipt_id) }))
}
