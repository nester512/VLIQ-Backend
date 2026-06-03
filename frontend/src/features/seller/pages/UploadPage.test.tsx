import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Module mocks.
// ---------------------------------------------------------------------------
vi.mock('@/api/sellers', () => ({
  getMe: vi.fn(() => Promise.resolve({ brand_id: 1 })),
}))

const mutateAsync = vi.fn(() => Promise.resolve({ id: '42' }))
vi.mock('../hooks/useUploadReceipt', () => ({
  useUploadReceipt: () => ({ mutateAsync, isPending: false, progress: null }),
}))

import { UploadPage } from './UploadPage'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<UploadPage />, { wrapper: Wrapper })
}

const closeScanQrPopup = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // Telegram WebApp QR scanner: the callback fires synchronously with a QR
  // string, mimicking a successful scan.
  ;(window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      showScanQrPopup: (_p: { text?: string }, cb?: (data: string) => void) => {
        cb?.('t=20240101T1200&s=100.00&fn=9999&i=1&fp=2&n=1')
      },
      closeScanQrPopup,
    },
  }
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { Telegram?: unknown }).Telegram
})

describe('UploadPage — QR scan flow', () => {
  // Regression guard: the scan callback captured the QR string but never closed
  // the Telegram scanner popup, so it stayed on top of the Mini App and the
  // user never reached the "QR-код отсканирован" screen / send button
  // ("находит, но не отправляет").
  it('closes the scanner popup and surfaces the scanned QR', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'QR-код' }))

    expect(closeScanQrPopup).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('QR-код отсканирован')).toBeInTheDocument()
    // The send button is now actionable.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Отправить чек' })).toBeEnabled(),
    )
  })
})
