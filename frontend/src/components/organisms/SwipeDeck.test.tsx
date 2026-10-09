import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
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

describe('SwipeDeck — approve/reject by swipe and buttons', () => {
  it('fires the same actions through native review buttons', () => {
    const onSwipe = vi.fn()
    render(<SwipeDeck receipts={[receipt()]} onSwipe={onSwipe} onTap={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' }))
    expect(onSwipe).toHaveBeenCalledWith('1', 'approve')
  })

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


describe('SwipeDeck — review-queue counter', () => {
  it('uses the server total as the denominator, not the loaded page size', () => {
    render(
      <SwipeDeck
        receipts={[receipt({ id: '1' }), receipt({ id: '2' })]}
        onSwipe={vi.fn()}
        onTap={vi.fn()}
        totalCount={1567}
      />,
    )
    expect(screen.getByTestId('deck-counter')).toHaveTextContent('1 / 1567')
  })

  it('falls back to the loaded count when no total is provided', () => {
    render(
      <SwipeDeck
        receipts={[receipt({ id: '1' }), receipt({ id: '2' })]}
        onSwipe={vi.fn()}
        onTap={vi.fn()}
      />,
    )
    expect(screen.getByTestId('deck-counter')).toHaveTextContent('1 / 2')
  })
})


describe('SwipeDeck — id-based consumption is refetch-safe (no skip)', () => {
  it('does not skip a card when the list shrinks from the front after a swipe', () => {
    const onSwipe = vi.fn()
    const a = receipt({ id: 'a' })
    const b = receipt({ id: 'b' })
    const c = receipt({ id: 'c' })
    const { rerender } = render(<SwipeDeck receipts={[a, b, c]} onSwipe={onSwipe} onTap={vi.fn()} />)

    // Approve the top card (a).
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' }))
    expect(onSwipe).toHaveBeenLastCalledWith('a', 'approve')

    // Simulate a mid-session refetch (detail-sheet action / window focus) that
    // drops the already-approved 'a' from the FRONT of the list.
    rerender(<SwipeDeck receipts={[b, c]} onSwipe={onSwipe} onTap={vi.fn()} />)

    // The next card must still be 'b' — a positional index would skip it to 'c'.
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' }))
    expect(onSwipe).toHaveBeenLastCalledWith('b', 'approve')
  })
})


describe('SwipeDeck — skip without a decision', () => {
  const three = () => [receipt({ id: 'a' }), receipt({ id: 'b' }), receipt({ id: 'c' })]

  it('«Пропустить» moves the card to the end and calls neither onSwipe nor the API', () => {
    const onSwipe = vi.fn()
    const onSkip = vi.fn()
    render(<SwipeDeck receipts={three()} onSwipe={onSwipe} onTap={vi.fn()} onSkip={onSkip} />)

    fireEvent.click(screen.getByRole('button', { name: 'Пропустить чек' }))

    expect(onSkip).toHaveBeenCalledWith('a')
    expect(onSwipe).not.toHaveBeenCalled()
    expect(screen.getByText(/пропущено 1/)).toBeInTheDocument()
    // Counter is unchanged: a skip is not a processed receipt.
    expect(screen.getByTestId('deck-counter')).toHaveTextContent('1 / 3')
    // The decision now applies to the next card.
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' }))
    expect(onSwipe).toHaveBeenCalledWith('b', 'approve')
  })

  it('a skipped card comes back after the others', () => {
    const onSwipe = vi.fn()
    render(<SwipeDeck receipts={three()} onSwipe={onSwipe} onTap={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Пропустить чек' })) // a → end: b, c, a
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' })) // b
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' })) // c
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' })) // a again

    expect(onSwipe.mock.calls).toEqual([['b', 'approve'], ['c', 'reject'], ['a', 'approve']])
  })

  it('a downward drag skips; a sideways drag still decides', () => {
    vi.useFakeTimers()
    const onSwipe = vi.fn()
    const onSkip = vi.fn()
    render(<SwipeDeck receipts={three()} onSwipe={onSwipe} onTap={vi.fn()} onSkip={onSkip} />)

    const card = topCard()
    fireEvent.pointerDown(card, { clientX: 200, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(card, { clientX: 210, clientY: 260, pointerId: 1 })
    fireEvent.pointerUp(card, { clientX: 210, clientY: 260, pointerId: 1 })

    expect(onSkip).toHaveBeenCalledWith('a')
    act(() => { vi.advanceTimersByTime(400) })
    expect(onSwipe).not.toHaveBeenCalled()
  })

  it('a card stuck in processing no longer blocks the deck', () => {
    const onSwipe = vi.fn()
    render(<SwipeDeck receipts={[receipt({ id: 'p', status: 'ocr_in_progress' }), receipt({ id: 'q' })]} onSwipe={onSwipe} onTap={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Одобрить' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить чек' }))
    fireEvent.click(screen.getByRole('button', { name: 'Одобрить' }))
    expect(onSwipe).toHaveBeenCalledWith('q', 'approve')
  })

  it('skip is disabled for the last card', () => {
    render(<SwipeDeck receipts={[receipt({ id: 'only' })]} onSwipe={vi.fn()} onTap={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Пропустить чек' })).toBeDisabled()
  })
})


describe('SwipeDeck — decision card without the photo', () => {
  const full = () => receipt({
    id: 'r1', seller_name: 'Анна Петрова', seller_store: 'ТЦ Радуга', amount: 145000, bonus_amount: 5000,
    purchase_date: '2026-10-08', shop_name: 'ООО Ромашка', fn: '9960440300712345', fd: '12345', fp: '3826178549',
    source: 'telegram_scan', verification_status: 'verified', verified_by: 'fns', duplicate_status: 'danger',
    fraud_signal: [
      { type: 'historical_duplicate_fn_fd_fp', details: 'x' },
      { type: 'receipt_too_old', details: 'y' },
      { type: 'demo_mode', details: 'hidden' },
    ],
  })

  it('shows the facts needed to decide and no photo', () => {
    render(<SwipeDeck receipts={[full()]} onSwipe={vi.fn()} onTap={vi.fn()} />)
    const card = screen.getByTestId('review-card-summary')
    expect(card).toHaveTextContent('Анна Петрова')
    expect(card).toHaveTextContent('ТЦ Радуга')
    expect(card).toHaveTextContent('1 450')
    expect(card).toHaveTextContent('+50')
    expect(card).toHaveTextContent('ООО Ромашка')
    expect(card).toHaveTextContent('…2345 · 12345 · 3826178549')
    expect(card).toHaveTextContent('QR · сканер Telegram')
    expect(card).toHaveTextContent('Подтверждён · ФНС') // who confirmed it
    expect(card).toHaveTextContent('Повтор чека')
    expect(card).toHaveTextContent('Старше 30 дней')
    expect(card).not.toHaveTextContent('hidden') // demo_mode is noise
    expect(card).toHaveTextContent('2 файла') // count only — the files open in «Подробнее»
    expect(card.querySelector('img')).toBeNull()
    expect(screen.queryByTestId('attachment-viewer')).toBeNull()
  })

  it('«Подробнее» opens the details without swiping or capturing the pointer', () => {
    const onSwipe = vi.fn()
    const onTap = vi.fn()
    const capture = vi.fn()
    const original = HTMLElement.prototype.setPointerCapture
    HTMLElement.prototype.setPointerCapture = capture
    try {
      render(<SwipeDeck receipts={[full(), receipt({ id: 'r2' })]} onSwipe={onSwipe} onTap={onTap} />)
      // Cards stack bottom-first in the DOM; only the TOP card reacts.
      const more = within(topCard()).getByRole('button', { name: /Подробнее/ })
      fireEvent.pointerDown(more, { clientX: 10, clientY: 10, pointerId: 3 })
      fireEvent.pointerUp(more, { clientX: 10, clientY: 10, pointerId: 3 })
      fireEvent.click(more)
      expect(onTap).toHaveBeenCalledWith('r1')
      expect(onSwipe).not.toHaveBeenCalled()
      expect(capture).not.toHaveBeenCalled()
    } finally {
      HTMLElement.prototype.setPointerCapture = original
    }
  })

  it('the seller name opens the seller page, not the card', () => {
    const onTap = vi.fn()
    const onSellerClick = vi.fn()
    render(<SwipeDeck receipts={[full()]} onSwipe={vi.fn()} onTap={onTap} onSellerClick={onSellerClick} />)
    const link = screen.getByRole('button', { name: /Открыть продавца Анна Петрова/ })
    fireEvent.pointerDown(link, { pointerId: 4 })
    fireEvent.pointerUp(link, { pointerId: 4 })
    fireEvent.click(link)
    expect(onSellerClick).toHaveBeenCalledWith(9)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('an unassigned bonus is said explicitly', () => {
    render(<SwipeDeck receipts={[receipt({ bonus_amount: 0 })]} onSwipe={vi.fn()} onTap={vi.fn()} />)
    expect(screen.getByTestId('review-card-summary')).toHaveTextContent('не назначен')
  })
})

describe('SwipeDeck — help instead of on-card hints', () => {
  it('no «Тап — фото и данные» hint; ⓘ next to the title explains everything', () => {
    render(<SwipeDeck receipts={[receipt()]} onSwipe={vi.fn()} onTap={vi.fn()} />)
    expect(screen.queryByText(/Тап — фото и данные/)).toBeNull()

    const info = screen.getByRole('button', { name: 'Как проверять чеки' })
    fireEvent.click(info)
    const panel = screen.getByRole('dialog', { name: 'Как проверять чеки' })
    expect(panel).toHaveTextContent('Свайп вправо или «Одобрить»')
    expect(panel).toHaveTextContent('Свайп вниз или «Пропустить»')
    expect(panel).toHaveTextContent('Подробнее')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Как проверять чеки' })).toBeNull()
  })

  it('action labels are shrinkable spans (no overflow on narrow screens)', () => {
    render(<SwipeDeck receipts={[receipt(), receipt({ id: '2' })]} onSwipe={vi.fn()} onTap={vi.fn()} />)
    for (const name of ['Отклонить', 'Одобрить']) {
      const btn = screen.getByRole('button', { name })
      expect(btn.querySelector('.vliq-review-native-action__label')).toHaveTextContent(name)
    }
  })
})
