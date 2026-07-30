import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'

const { getAdminReceipts } = vi.hoisted(() => ({ getAdminReceipts: vi.fn() }))

vi.mock('@/api/admin', () => ({ getAdminReceipts }))
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (state: { openSheet: () => void }) => unknown) => selector({ openSheet: () => {} }),
}))

import { AdminReceiptsPage } from './AdminReceiptsPage'

afterEach(() => {
  cleanup()
  getAdminReceipts.mockReset()
})

function renderPage(entry = '/admin/receipts') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <AdminReceiptsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminReceiptsPage — archive filters (KAN-31)', () => {
  it('requests only approved receipts when opened from the average-check metric', async () => {
    getAdminReceipts.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100, has_more: false })
    renderPage('/admin/receipts?status=approved')

    await waitFor(() => {
      expect(getAdminReceipts).toHaveBeenCalledWith({ status: ['approved'], limit: 100 })
    })
  })

  it('updates the API filter from the visible filter controls', async () => {
    getAdminReceipts.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100, has_more: false })
    renderPage()
    await waitFor(() => expect(getAdminReceipts).toHaveBeenCalledWith({ status: undefined, limit: 100 }))

    fireEvent.click(screen.getByRole('button', { name: 'На проверке' }))

    await waitFor(() => {
      expect(getAdminReceipts).toHaveBeenLastCalledWith({ status: ['on_review'], limit: 100 })
    })
  })
})
