import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { SwipeDeck } from './SwipeDeck'
import type { AdminReceipt } from '@/api/admin'
import type { Attachment } from '@/types/models'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function img(over: Partial<Attachment> = {}): Attachment {
  return { id: 1, position: 0, kind: 'image', mime_type: 'image/jpeg', url: 'https://x/1.jpg', ...over }
}

function receipt(over: Partial<AdminReceipt> = {}): AdminReceipt {
  return {
    id: '1',
    seller_id: 9,
    status: 'on_review',
    seller_name: 'Иван Петров',
    seller_store: 'ТЦ Радуга',
    amount: 100000,
    bonus_amount: 2000,
    created_at: '2026-06-20T10:00:00Z',
    attachments: [img({ id: 1, position: 0 }), img({ id: 2, position: 1 })],
    ...over,
  }
}

/** The top SwipeCard root is the only element styled `cursor: grab`. */
function topCard(): HTMLElement {
  const el = document.querySelector('[style*="cursor: grab"]')
  if (!(el instanceof HTMLElement)) throw new Error('top card not found')
  return el
}

describe('SwipeDeck — outer approve/reject swipe still works with the AttachmentViewer', () => {
  it('fires onSwipe("approve") on a horizontal right drag of the top card', () => {
    vi.useFakeTimers()
    const onSwipe = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={vi.fn()} />)

    const card = topCard()
    fireEvent.pointerDown(card, { clientX: 100, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(card, { clientX: 320, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(card, { clientX: 320, clientY: 200, pointerId: 1 })

    // doFly defers the onSwipe dispatch by ~320ms.
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onSwipe).toHaveBeenCalledWith('1', 'approve')
  })

  it('fires onSwipe("reject") on a horizontal left drag', () => {
    vi.useFakeTimers()
    const onSwipe = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={vi.fn()} />)

    const card = topCard()
    fireEvent.pointerDown(card, { clientX: 300, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(card, { clientX: 60, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(card, { clientX: 60, clientY: 200, pointerId: 1 })

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onSwipe).toHaveBeenCalledWith('1', 'reject')
  })

  it('advancing an attachment via the next zone does NOT fire onSwipe', () => {
    const onSwipe = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={vi.fn()} />)

    // Two attachments on the top card → a "next" nav zone exists.
    const next = screen.getAllByLabelText('Следующее вложение')[0]!
    fireEvent.pointerDown(next, { pointerId: 2 })
    fireEvent.click(next)

    // The counter advances but no approve/reject is dispatched.
    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('2 / 2')
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('still fires approve when a horizontal drag starts on the right attachment tap-zone', () => {
    vi.useFakeTimers()
    const onSwipe = vi.fn()
    const onTap = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={onTap} />)

    const next = screen.getAllByLabelText('Следующее вложение')[0]!
    fireEvent.pointerDown(next, { clientX: 260, clientY: 200, pointerId: 12 })
    fireEvent.pointerMove(next, { clientX: 390, clientY: 200, pointerId: 12 })
    fireEvent.pointerUp(next, { clientX: 390, clientY: 200, pointerId: 12 })

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(onSwipe).toHaveBeenCalledWith('1', 'approve')
    expect(onTap).not.toHaveBeenCalled()
  })

  it('tapping an attachment nav zone on a non-actionable card does not open details', () => {
    const onSwipe = vi.fn()
    const onTap = vi.fn()
    render(<SwipeDeck receipts={[receipt({ status: 'pending' })]} onSwipe={onSwipe} onTap={onTap} />)

    const next = screen.getAllByLabelText('Следующее вложение')[0]!
    fireEvent.pointerDown(next, { clientX: 260, clientY: 200, pointerId: 13 })
    fireEvent.pointerUp(next, { clientX: 260, clientY: 200, pointerId: 13 })
    fireEvent.click(next)

    expect(screen.getByTestId('attachment-counter')).toHaveTextContent('2 / 2')
    expect(onTap).not.toHaveBeenCalled()
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('exposes the 2 attachment pages + a final info-card page showing seller/store', () => {
    const onSwipe = vi.fn()
    const onTap = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={onTap} />)

    // Page 1: first attachment.
    expect(screen.getAllByTestId('attachment-counter')[0]!).toHaveTextContent('1 / 2')

    const advance = () => {
      const next = screen.getAllByLabelText('Следующее вложение')[0]!
      fireEvent.pointerDown(next, { pointerId: 9 })
      fireEvent.click(next)
    }
    advance() // → page 2 (attachment 2)
    expect(screen.getAllByTestId('attachment-counter')[0]!).toHaveTextContent('2 / 2')
    advance() // → final info-card page

    const finalCard = screen.getAllByTestId('attachment-final-card')[0]!
    expect(finalCard).toBeInTheDocument()
    // The final page renders the receipt+seller info card.
    expect(finalCard).toHaveTextContent('Иван Петров')
    expect(finalCard).toHaveTextContent('ТЦ Радуга')
    // Navigating to the final page never fired a swipe nor a tap.
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
  })

  it('navigating to the final info-card page does not fire onSwipe/onTap; a pointerdown on it stays inert', () => {
    const onSwipe = vi.fn()
    const onTap = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={onTap} />)

    const advance = () => {
      const next = screen.getAllByLabelText('Следующее вложение')[0]!
      fireEvent.pointerDown(next, { pointerId: 9 })
      fireEvent.click(next)
    }
    advance()
    advance() // → final card

    // A pointerdown on the final card must NOT reach the card's drag/tap.
    fireEvent.pointerDown(screen.getAllByTestId('attachment-final-card')[0]!, {
      clientX: 200,
      clientY: 200,
      pointerId: 11,
    })
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
  })

  it('the fullscreen zoom control opens the lightbox and fires neither onSwipe nor onTap', () => {
    const onSwipe = vi.fn()
    const onTap = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={onTap} />)

    const zoom = screen.getAllByTestId('attachment-zoom-button')[0]!
    fireEvent.pointerDown(zoom, { pointerId: 7 })
    fireEvent.click(zoom)

    expect(screen.getByTestId('attachment-lightbox')).toBeInTheDocument()
    expect(onSwipe).not.toHaveBeenCalled()
    expect(onTap).not.toHaveBeenCalled()
  })

  it('a plain tap (no drag) on the card calls onTap, not onSwipe', () => {
    const onSwipe = vi.fn()
    const onTap = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={onTap} />)

    const card = topCard()
    fireEvent.pointerDown(card, { clientX: 100, clientY: 200, pointerId: 3 })
    fireEvent.pointerUp(card, { clientX: 100, clientY: 200, pointerId: 3 })

    expect(onTap).toHaveBeenCalledWith('1')
    expect(onSwipe).not.toHaveBeenCalled()
  })
})
