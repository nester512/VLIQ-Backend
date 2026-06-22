import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Module mocks — the batch upload endpoint is the only seller-facing submission.
// ---------------------------------------------------------------------------
const uploadReceiptPackage = vi.fn<(...a: unknown[]) => Promise<unknown>>()
vi.mock('@/api/receipts', () => ({
  uploadReceiptPackage: (...a: unknown[]) => uploadReceiptPackage(...a),
}))

const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast }),
}))

// extractApiError returns the backend's user_message — the hook must show it.
const extractApiError = vi.fn<(...a: unknown[]) => unknown>(() => ({
  code: 'RECEIPT_FILE_TOO_LARGE',
  userMessage: 'Файл слишком большой.',
  debugId: '',
  status: 413,
}))
vi.mock('@/api/client', () => ({
  api: {},
  extractApiError: (...a: unknown[]) => extractApiError(...a),
}))

import { useUploadReceipt } from './useUploadReceipt'

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useUploadReceipt — batch submission', () => {
  it('submits files + scannedQr + brandId in ONE call with an idempotency key', async () => {
    uploadReceiptPackage.mockResolvedValueOnce({ id: '42', warnings: [] })
    const { result } = renderHook(() => useUploadReceipt(), { wrapper: makeWrapper() })

    const files = [makeFile('a.jpg'), makeFile('b.jpg')]
    result.current.mutate({ files, scannedQr: 't=1&fn=2', brandId: 9 })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(uploadReceiptPackage).toHaveBeenCalledTimes(1)
    const [sentFiles, opts] = uploadReceiptPackage.mock.calls[0] as unknown as [
      File[],
      { brandId: number; scannedQr?: string; idempotencyKey: string },
    ]
    expect(sentFiles).toEqual(files)
    expect(opts.brandId).toBe(9)
    expect(opts.scannedQr).toBe('t=1&fn=2')
    expect(typeof opts.idempotencyKey).toBe('string')
    expect(opts.idempotencyKey.length).toBeGreaterThan(0)
    expect(pushToast).toHaveBeenCalledWith('Чек успешно загружен', 'ok')
  })

  it('shows each POSSIBLE_DUPLICATE warning as a non-blocking toast on success', async () => {
    uploadReceiptPackage.mockResolvedValueOnce({
      id: '99',
      warnings: [
        {
          code: 'POSSIBLE_DUPLICATE',
          message: 'Похожий чек уже загружался ранее. Вы всё равно можете отправить его на проверку.',
        },
      ],
    })
    const { result } = renderHook(() => useUploadReceipt(), { wrapper: makeWrapper() })

    result.current.mutate({ files: [makeFile('a.jpg')], brandId: 1 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Success toast first, then the warning toast (non-blocking).
    expect(pushToast).toHaveBeenCalledWith('Чек успешно загружен', 'ok')
    expect(pushToast).toHaveBeenCalledWith(
      'Похожий чек уже загружался ранее. Вы всё равно можете отправить его на проверку.',
      'wn',
    )
    // The submission still resolves with the receipt id so the page navigates.
    expect(result.current.data).toEqual({ id: '99', warnings: expect.any(Array) })
  })

  it('surfaces extractApiError.userMessage on failure (not a generic toast)', async () => {
    uploadReceiptPackage.mockRejectedValueOnce({ response: { status: 413 } })
    const { result } = renderHook(() => useUploadReceipt(), { wrapper: makeWrapper() })

    result.current.mutate({ files: [makeFile('a.jpg')], brandId: 1 })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(extractApiError).toHaveBeenCalled()
    expect(pushToast).toHaveBeenCalledWith('Файл слишком большой.', 'dg')
  })

  it('reuses the SAME idempotency_key when retrying a failed submission', async () => {
    uploadReceiptPackage.mockRejectedValueOnce({ response: { status: 500 } })
    const { result } = renderHook(() => useUploadReceipt(), { wrapper: makeWrapper() })

    // First attempt fails.
    result.current.mutate({ files: [makeFile('a.jpg')], brandId: 1 })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const firstKey = (uploadReceiptPackage.mock.calls[0]?.[1] as { idempotencyKey: string })
      .idempotencyKey

    // Retry succeeds.
    uploadReceiptPackage.mockResolvedValueOnce({ id: '7', warnings: [] })
    result.current.mutate({ files: [makeFile('a.jpg')], brandId: 1 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const secondKey = (uploadReceiptPackage.mock.calls[1]?.[1] as { idempotencyKey: string })
      .idempotencyKey

    expect(secondKey).toBe(firstKey)
  })

  it('rotates the idempotency_key for a NEW submission after success', async () => {
    uploadReceiptPackage.mockResolvedValue({ id: '1', warnings: [] })
    const { result } = renderHook(() => useUploadReceipt(), { wrapper: makeWrapper() })

    result.current.mutate({ files: [makeFile('a.jpg')], brandId: 1 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const firstKey = (uploadReceiptPackage.mock.calls[0]?.[1] as { idempotencyKey: string })
      .idempotencyKey

    result.current.mutate({ files: [makeFile('b.jpg')], brandId: 1 })
    await waitFor(() => expect(uploadReceiptPackage).toHaveBeenCalledTimes(2))
    const secondKey = (uploadReceiptPackage.mock.calls[1]?.[1] as { idempotencyKey: string })
      .idempotencyKey

    expect(secondKey).not.toBe(firstKey)
  })
})
