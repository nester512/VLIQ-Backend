import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Receipt } from '@/types/models'

// ---------------------------------------------------------------------------
// Mock the status fetch so we can drive the rendered attachments.
// ---------------------------------------------------------------------------
const getReceiptStatus = vi.fn<(...a: unknown[]) => Promise<Receipt>>()
vi.mock('@/api/receipts', () => ({
  getReceiptStatus: (...a: unknown[]) => getReceiptStatus(...a),
}))

import { StatusPage } from './StatusPage'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/seller/status/42']}>
          <Routes>
            <Route path="/seller/status/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<StatusPage />, { wrapper: Wrapper })
}

function baseReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    id: '42',
    seller_id: 0,
    status: 'on_review',
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => cleanup())

describe('StatusPage — attachment rendering', () => {
  it('renders ALL attachments ordered by position (images inline, PDF as link)', async () => {
    getReceiptStatus.mockResolvedValue(
      baseReceipt({
        attachments: [
          // Deliberately out of order — must be sorted by position.
          { id: 2, position: 1, kind: 'pdf', mime_type: 'application/pdf', url: 'https://x/doc.pdf' },
          { id: 1, position: 0, kind: 'image', mime_type: 'image/jpeg', url: 'https://x/a.jpg' },
          { id: 3, position: 2, kind: 'image', mime_type: 'image/png', url: 'https://x/b.png' },
        ],
      }),
    )
    renderPage()

    // Two images render inline.
    const imgs = await screen.findAllByAltText('Фото чека')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toHaveAttribute('src', 'https://x/a.jpg')

    // PDF renders as a link, not an <img>.
    const pdfLink = screen.getByRole('link', { name: /Открыть PDF/ })
    expect(pdfLink).toHaveAttribute('href', 'https://x/doc.pdf')
  })

  it('falls back to legacy file_url when attachments are empty', async () => {
    getReceiptStatus.mockResolvedValue(
      baseReceipt({ attachments: [], file_url: 'https://x/legacy.jpg' }),
    )
    renderPage()

    const img = await screen.findByAltText('Фото чека')
    expect(img).toHaveAttribute('src', 'https://x/legacy.jpg')
  })

  it('renders nothing extra when there are no attachments and no file_url', async () => {
    getReceiptStatus.mockResolvedValue(baseReceipt({}))
    renderPage()

    await screen.findByText('Статус обработки')
    expect(screen.queryByText('Загруженный чек')).not.toBeInTheDocument()
  })
})
