import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { AttachmentViewer } from './AttachmentViewer'
import type { Attachment } from '@/types/models'

afterEach(cleanup)

function img(over: Partial<Attachment> = {}): Attachment {
  return { id: 1, position: 0, kind: 'image', mime_type: 'image/jpeg', url: 'https://x/1.jpg', ...over }
}
function pdf(over: Partial<Attachment> = {}): Attachment {
  return { id: 2, position: 1, kind: 'pdf', mime_type: 'application/pdf', url: 'https://x/2.pdf', ...over }
}

describe('AttachmentViewer — single attachment', () => {
  it('renders one image and a "1 / 1" counter without nav controls', () => {
    render(<AttachmentViewer attachments={[img()]} />)
    expect(screen.getByTestId('attachment-image')).toBeInTheDocument()
    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('1 / 1')
    // No second page → no nav arrows / dots.
    expect(screen.queryByLabelText('Следующее вложение')).toBeNull()
    expect(screen.queryByTestId('attachment-dots')).toBeNull()
  })
})

describe('AttachmentViewer — multiple attachments', () => {
  const items = [img({ id: 10, position: 1 }), img({ id: 11, position: 0 }), pdf({ id: 12, position: 2 })]

  it('orders by position (stable) and shows "1 / 3"', () => {
    render(<AttachmentViewer attachments={items} />)
    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('1 / 3')
    // position 0 first → image surface
    expect(screen.getByTestId('attachment-image')).toBeInTheDocument()
  })

  it('navigates forward via the next tap-zone (not a swipe)', () => {
    render(<AttachmentViewer attachments={items} />)
    fireEvent.click(screen.getByLabelText('Следующее вложение'))
    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('2 / 3')
    // Advance to the PDF (position 2).
    fireEvent.click(screen.getByLabelText('Следующее вложение'))
    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('3 / 3')
    expect(screen.getByTestId('attachment-pdf')).toBeInTheDocument()
  })

  it('renders a dot per page', () => {
    render(<AttachmentViewer attachments={items} />)
    const dots = screen.getByTestId('attachment-dots')
    expect(within(dots).getAllByText('', { selector: 'span' }).length).toBe(3)
  })
})

describe('AttachmentViewer — nav controls do NOT bubble to the host (no approve/reject)', () => {
  it('stops pointerdown and click propagation on the next zone', () => {
    const hostPointerDown = vi.fn()
    const hostClick = vi.fn()
    render(
      <div onPointerDown={hostPointerDown} onClick={hostClick}>
        <AttachmentViewer attachments={[img({ id: 1, position: 0 }), img({ id: 2, position: 1 })]} />
      </div>,
    )
    const next = screen.getByLabelText('Следующее вложение')
    fireEvent.pointerDown(next)
    fireEvent.click(next)
    // The outer host (which in production is SwipeDeck's drag surface) must
    // never see the nav interaction — otherwise tapping to advance would fire
    // an approve/reject.
    expect(hostPointerDown).not.toHaveBeenCalled()
    expect(hostClick).not.toHaveBeenCalled()
    // And the page actually advanced.
    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('2 / 2')
  })
})

describe('AttachmentViewer — broken / null / unsupported url', () => {
  it('shows a fallback card when the image fails to load (onError)', () => {
    render(<AttachmentViewer attachments={[img()]} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByTestId('attachment-fallback')).toBeInTheDocument()
  })

  it('shows a fallback card when url is null', () => {
    render(<AttachmentViewer attachments={[img({ url: null })]} />)
    expect(screen.getByTestId('attachment-fallback')).toHaveTextContent('Файл недоступен')
  })

  it('never crashes with a null-url pdf', () => {
    render(<AttachmentViewer attachments={[pdf({ url: null })]} />)
    expect(screen.getByTestId('attachment-fallback')).toBeInTheDocument()
  })
})

describe('AttachmentViewer — PDF handling', () => {
  it('renders an "Открыть PDF" action that opens the file', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<AttachmentViewer attachments={[pdf()]} />)
    expect(screen.getByTestId('attachment-pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Открыть PDF'))
    expect(openSpy).toHaveBeenCalledWith('https://x/2.pdf', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })
})

describe('AttachmentViewer — fullscreen image (lightbox)', () => {
  it('opens and closes the lightbox on image tap (interactive default)', () => {
    render(<AttachmentViewer attachments={[img()]} />)
    fireEvent.click(screen.getByTestId('attachment-image'))
    expect(screen.getByTestId('attachment-lightbox')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Закрыть'))
    expect(screen.queryByTestId('attachment-lightbox')).toBeNull()
  })

  it('does NOT make the image body a zoom button when interactiveImage=false', () => {
    render(<AttachmentViewer attachments={[img()]} interactiveImage={false} />)
    const surface = screen.getByTestId('attachment-image')
    expect(surface.tagName).toBe('DIV') // not a <button>
  })

  it('still exposes an explicit zoom button when interactiveImage=false (feed)', () => {
    render(<AttachmentViewer attachments={[img()]} interactiveImage={false} />)
    // The corner fullscreen affordance is present even for inert images so an
    // admin can open the receipt fullscreen straight from the SwipeDeck feed.
    fireEvent.click(screen.getByTestId('attachment-zoom-button'))
    expect(screen.getByTestId('attachment-lightbox')).toBeInTheDocument()
  })

  it('the inert-feed zoom button does NOT bubble pointerdown/click to the host', () => {
    // In production the host is SwipeDeck's drag surface — opening fullscreen
    // must never be read as an approve/reject swipe nor a detail-sheet tap.
    const hostPointerDown = vi.fn()
    const hostClick = vi.fn()
    render(
      <div onPointerDown={hostPointerDown} onClick={hostClick}>
        <AttachmentViewer attachments={[img()]} interactiveImage={false} />
      </div>,
    )
    const zoom = screen.getByTestId('attachment-zoom-button')
    fireEvent.pointerDown(zoom)
    fireEvent.click(zoom)
    expect(hostPointerDown).not.toHaveBeenCalled()
    expect(hostClick).not.toHaveBeenCalled()
    expect(screen.getByTestId('attachment-lightbox')).toBeInTheDocument()
  })

  it('the image BODY stays inert (no stopPropagation) so the deck drag survives', () => {
    // Pointerdown on the image body itself must reach the host so the outer
    // SwipeDeck horizontal drag (approve/reject) still works from the centre.
    const hostPointerDown = vi.fn()
    render(
      <div onPointerDown={hostPointerDown}>
        <AttachmentViewer attachments={[img()]} interactiveImage={false} />
      </div>,
    )
    fireEvent.pointerDown(screen.getByTestId('attachment-image'))
    expect(hostPointerDown).toHaveBeenCalled()
  })
})

describe('AttachmentViewer — final info card page', () => {
  it('shows the final card after the last attachment', () => {
    render(
      <AttachmentViewer
        attachments={[img()]}
        finalCard={<div data-testid="final">data</div>}
      />,
    )
    // Page 1 of 1 attachment, plus a final page → has nav.
    fireEvent.click(screen.getByLabelText('Следующее вложение'))
    expect(screen.getByTestId('attachment-final-card')).toBeInTheDocument()
    expect(screen.getByTestId('final')).toBeInTheDocument()
    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('Данные чека')
  })

  it('renders the empty fallback when there are no attachments and no final card', () => {
    render(
      <AttachmentViewer attachments={[]} emptyFallback={<div data-testid="empty">x</div>} />,
    )
    expect(screen.getByTestId('empty')).toBeInTheDocument()
  })

  it('shows only the final card when there are no attachments but a final card exists', () => {
    render(<AttachmentViewer attachments={[]} finalCard={<div data-testid="final">d</div>} />)
    expect(screen.getByTestId('attachment-final-card')).toBeInTheDocument()
    // Single page → no nav.
    expect(screen.queryByLabelText('Следующее вложение')).toBeNull()
  })

  it('stops pointerdown on the final-card surface so the host never swipes/taps', () => {
    // The final info page must NEVER fire an approve/reject swipe nor the
    // detail-sheet tap — scrolling/tapping it stays inside the viewer.
    const hostPointerDown = vi.fn()
    render(
      <div onPointerDown={hostPointerDown}>
        <AttachmentViewer
          attachments={[img({ id: 1, position: 0 })]}
          finalCard={<div data-testid="final">d</div>}
        />
      </div>,
    )
    fireEvent.click(screen.getByLabelText('Следующее вложение'))
    fireEvent.pointerDown(screen.getByTestId('attachment-final-card'))
    expect(hostPointerDown).not.toHaveBeenCalled()
  })
})
