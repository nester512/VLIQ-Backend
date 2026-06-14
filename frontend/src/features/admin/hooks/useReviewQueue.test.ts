import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Module mocks — the swipe actions and side-effect layers are replaced so the
// hook resolves deterministically under jsdom.
// ---------------------------------------------------------------------------
const approveReceipt = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
const rejectReceipt = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
const reviseReceipt = vi.fn<(...a: unknown[]) => Promise<unknown>>(() => Promise.resolve({}))
vi.mock('@/api/admin', () => ({
  getAdminReceipts: vi.fn(() => Promise.resolve({ items: [], page: 1, has_more: false })),
  approveReceipt: (...a: unknown[]) => approveReceipt(...a),
  rejectReceipt: (...a: unknown[]) => rejectReceipt(...a),
  reviseReceipt: (...a: unknown[]) => reviseReceipt(...a),
}))

const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast }),
}))

vi.mock('@/hooks/useHaptic', () => ({
  useHaptic: () => ({ impact: vi.fn(), notification: vi.fn() }),
}))

vi.mock('@/api/client', () => ({
  api: {},
  extractApiError: () => ({ code: 'X', userMessage: 'err', debugId: '', status: 0 }),
}))

import { useSwipeAction } from './useReviewQueue'

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
  return { Wrapper, invalidateSpy }
}

function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>): string[][] {
  return spy.mock.calls.map((c: unknown[]) => (c[0] as { queryKey?: unknown[] })?.queryKey as string[])
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSwipeAction — review-queue is NOT invalidated on success', () => {
  // Regression guard: invalidating ['admin','review-queue'] after each swipe
  // refetched the queue and dropped the just-actioned receipt while SwipeDeck's
  // local deckIdx had also advanced — consuming two cards per swipe so the rest
  // "disappeared". The dashboard counters still refresh.
  it('approve: invalidates dashboard but not review-queue', async () => {
    const { Wrapper, invalidateSpy } = makeWrapper()
    const { result } = renderHook(() => useSwipeAction(), { wrapper: Wrapper })

    result.current.mutate({ id: '1', dir: 'approve' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const keys = invalidatedKeys(invalidateSpy)
    expect(keys).toContainEqual(['admin', 'dashboard'])
    expect(keys).not.toContainEqual(['admin', 'review-queue'])
  })

  it('revise: invalidates dashboard but not review-queue', async () => {
    const { Wrapper, invalidateSpy } = makeWrapper()
    const { result } = renderHook(() => useSwipeAction(), { wrapper: Wrapper })

    result.current.mutate({ id: '2', dir: 'revise', comment: 'переснимите' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const keys = invalidatedKeys(invalidateSpy)
    expect(keys).toContainEqual(['admin', 'dashboard'])
    expect(keys).not.toContainEqual(['admin', 'review-queue'])
  })
})
