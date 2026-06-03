import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Module mocks — the QR endpoint rejects so we exercise the onError branch.
// ---------------------------------------------------------------------------
const submitQrPayload = vi.fn<(...a: unknown[]) => Promise<unknown>>()
vi.mock('@/api/receipts', () => ({
  submitQrPayload: (...a: unknown[]) => submitQrPayload(...a),
  uploadReceipt: vi.fn(),
  getUploadUrl: vi.fn(),
  finalizeUpload: vi.fn(),
}))

const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast }),
}))

// extractApiError returns the backend's user_message — the hook must show it.
const extractApiError = vi.fn<(...a: unknown[]) => unknown>(() => ({
  code: 'RECEIPT_DUPLICATE',
  userMessage: 'Этот чек уже был загружен ранее.',
  debugId: '',
  status: 409,
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useUploadReceipt — onError surfaces the backend message', () => {
  it('shows extractApiError.userMessage on failure (not a generic toast)', async () => {
    submitQrPayload.mockRejectedValueOnce({ response: { status: 409 } })
    const { result } = renderHook(() => useUploadReceipt(), { wrapper: makeWrapper() })

    result.current.mutate({ qrRaw: 't=1&fn=2&i=3&fp=4' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(extractApiError).toHaveBeenCalled()
    expect(pushToast).toHaveBeenCalledWith('Этот чек уже был загружен ранее.', 'dg')
  })
})
