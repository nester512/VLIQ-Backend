import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, within, cleanup, fireEvent } from '@testing-library/react'
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

interface SubmitArgs {
  files: File[]
  scannedQr?: string
  brandId?: number
}
const mutateAsync = vi.fn<(args: SubmitArgs) => Promise<{ id: string; warnings?: unknown[] }>>(() =>
  Promise.resolve({ id: '42', warnings: [] }),
)
vi.mock('../hooks/useUploadReceipt', () => ({
  useUploadReceipt: () => ({ mutateAsync, isPending: false, progress: null }),
}))

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const pushToast = vi.fn()
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast }),
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

function makeImage(name: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' })
}
function makePdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: 'application/pdf' })
}
function makeText(name: string): File {
  return new File(['plain'], name, { type: 'text/plain' })
}
function makeHugeImage(name: string): File {
  return new File([new Uint8Array(11 * 1024 * 1024)], name, { type: 'image/jpeg' })
}

/** The hidden "PDF / файл" picker accepts both images and PDFs. */
function pdfFileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[type="file"][accept="image/*,application/pdf"]',
  )
  if (!input) throw new Error('file input not found')
  return input
}

const closeScanQrPopup = vi.fn()
const SCANNED = 't=20240101T1200&s=100.00&fn=9999&i=1&fp=2&n=1'

beforeEach(() => {
  vi.clearAllMocks()
  // Telegram WebApp QR scanner: the callback fires synchronously with a QR
  // string, mimicking a successful scan.
  ;(window as unknown as { Telegram: unknown }).Telegram = {
    WebApp: {
      showScanQrPopup: (_p: { text?: string }, cb?: (data: string) => void) => {
        cb?.(SCANNED)
      },
      closeScanQrPopup,
    },
  }
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { Telegram?: unknown }).Telegram
})

describe('UploadPage — file selection', () => {
  it('explains the required files and optional QR before upload', () => {
    renderPage()

    expect(screen.getByText('Как загрузить чек')).toBeInTheDocument()
    expect(screen.getByText(/Добавьте от 1 до 5 файлов/)).toBeInTheDocument()
    expect(screen.getByText(/QR-код необязателен/)).toBeInTheDocument()
  })

  it('selects one image and shows a tile + counter', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), makeImage('a.jpg'))

    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(1)
    expect(screen.getByText('Файлов: 1/5')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отправить чек' })).toBeEnabled()
  })

  it('selecting five files renders five tiles', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(
      pdfFileInput(),
      [1, 2, 3, 4, 5].map((n) => makeImage(`f${n}.jpg`)),
    )

    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(5)
    expect(screen.getByText('Файлов: 5/5')).toBeInTheDocument()
  })

  it('renders mixed image + PDF tiles (PDF is NOT an <img>)', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), [makeImage('a.jpg'), makePdf('doc.pdf')])

    const tiles = screen.getAllByTestId('attachment-tile')
    expect(tiles).toHaveLength(2)
    // The PDF tile shows a safe card (name + "PDF"), never an <img>.
    expect(screen.getByText('doc.pdf')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
    // Exactly one tile contains an image (the jpeg).
    const imgs = tiles.flatMap((t) => within(t).queryAllByRole('img'))
    expect(imgs).toHaveLength(1)
  })

  it('MERGES additional files with the existing selection', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), [makeImage('a.jpg'), makeImage('b.jpg')])
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(2)

    await user.upload(pdfFileInput(), makeImage('c.jpg'))
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(3)
    expect(screen.getByText('Файлов: 3/5')).toBeInTheDocument()
  })

  it('rejects a 6th file — keeps the first 5 and warns', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(
      pdfFileInput(),
      [1, 2, 3, 4, 5, 6].map((n) => makeImage(`f${n}.jpg`)),
    )

    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(5)
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('не более 5'), 'wn')
  })

  it('rejects unsupported file types before submit', () => {
    renderPage()

    fireEvent.change(pdfFileInput(), { target: { files: [makeText('notes.txt')] } })

    expect(screen.queryAllByTestId('attachment-tile')).toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent('notes.txt: поддерживаются только фото или PDF')
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('notes.txt'), 'dg')
  })

  it('rejects files larger than 10 MB before submit', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), makeHugeImage('huge.jpg'))

    expect(screen.queryAllByTestId('attachment-tile')).toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent('huge.jpg: файл больше 10.0 МБ')
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining('huge.jpg'), 'dg')
  })

  it('removing one tile keeps the rest', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), [makeImage('a.jpg'), makeImage('b.jpg')])
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Удалить a.jpg' }))
    const tiles = screen.getAllByTestId('attachment-tile')
    expect(tiles).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Удалить b.jpg' })).toBeInTheDocument()
  })
})

describe('UploadPage — QR is additive and independent', () => {
  it('closes the scanner popup and surfaces the scanned QR', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'QR-код' }))

    expect(closeScanQrPopup).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('QR-код отсканирован')).toBeInTheDocument()
  })

  it('QR-only (no files) is NOT submittable', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'QR-код' }))
    await screen.findByText('QR-код отсканирован')

    expect(screen.getByRole('button', { name: 'Выберите файл' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'QR-код добавлен. Теперь прикрепите фото или PDF чека — один QR без файла не отправляется.',
    )
  })

  it('scanning a QR does NOT clear selected files', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), [makeImage('a.jpg'), makeImage('b.jpg')])
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'QR-код' }))
    await screen.findByText('QR-код отсканирован')

    // Files survive the scan.
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(2)
  })

  it('selecting files does NOT clear a scanned QR', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'QR-код' }))
    await screen.findByText('QR-код отсканирован')

    await user.upload(pdfFileInput(), makeImage('a.jpg'))

    // QR survives the file selection.
    expect(screen.getByText('QR-код отсканирован')).toBeInTheDocument()
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(1)
  })

  it('QR can be cleared independently of the files', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), makeImage('a.jpg'))
    await user.click(screen.getByRole('button', { name: 'QR-код' }))
    await screen.findByText('QR-код отсканирован')

    await user.click(screen.getByRole('button', { name: 'Убрать QR-код' }))

    expect(screen.queryByText('QR-код отсканирован')).not.toBeInTheDocument()
    // Files are untouched.
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(1)
  })
})

describe('UploadPage — submit', () => {
  it('submits ONE batch call with all files + brand_id (no per-file loop)', async () => {
    const user = userEvent.setup()
    renderPage()

    const files = [makeImage('a.jpg'), makeImage('b.jpg'), makePdf('c.pdf')]
    await user.upload(pdfFileInput(), files)

    await user.click(screen.getByRole('button', { name: 'Отправить чек' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const arg = mutateAsync.mock.calls[0]?.[0]
    expect(arg?.files).toHaveLength(3)
    expect(arg?.files.map((f) => f.name)).toEqual(['a.jpg', 'b.jpg', 'c.pdf'])
    expect(arg?.brandId).toBe(1)
    // No QR scanned → scannedQr is undefined (not sent).
    expect(arg?.scannedQr).toBeUndefined()
  })

  it('includes scanned_qr in the single submission when a QR was scanned', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), makeImage('a.jpg'))
    await user.click(screen.getByRole('button', { name: 'QR-код' }))
    await screen.findByText('QR-код отсканирован')

    await user.click(screen.getByRole('button', { name: 'Отправить чек' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const arg = mutateAsync.mock.calls[0]?.[0]
    expect(arg?.scannedQr).toBe(SCANNED)
  })

  it('navigates to the single receipt status page on success', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), [makeImage('a.jpg'), makeImage('b.jpg')])
    await user.click(screen.getByRole('button', { name: 'Отправить чек' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(navigate).toHaveBeenCalledWith('/seller/status/42')
  })

  it('keeps the selection when submit fails (so the user can retry)', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('network'))
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), [makeImage('a.jpg'), makeImage('b.jpg')])
    await user.click(screen.getByRole('button', { name: 'Отправить чек' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    // Selection survives the failure.
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(2)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows a file-specific error inline on a 413 and keeps the selection', async () => {
    mutateAsync.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 413,
        data: {
          code: 'RECEIPT_FILE_TOO_LARGE',
          user_message: 'Файл слишком большой. Максимальный размер — 10 МБ.',
          debug_id: 'd-1',
        },
      },
    })
    const user = userEvent.setup()
    renderPage()

    await user.upload(pdfFileInput(), makeImage('huge.jpg'))
    await user.click(screen.getByRole('button', { name: 'Отправить чек' }))

    // Inline, file-specific message surfaced next to the tiles.
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'Файл слишком большой. Максимальный размер — 10 МБ.',
      ),
    )
    expect(screen.getAllByTestId('attachment-tile')).toHaveLength(1)
    expect(navigate).not.toHaveBeenCalled()

    // Editing the selection clears the stale inline error.
    await user.upload(pdfFileInput(), makeImage('small.jpg'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
