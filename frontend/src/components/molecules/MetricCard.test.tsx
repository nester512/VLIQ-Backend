import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MetricCard } from './MetricCard'

afterEach(cleanup)

describe('MetricCard — actionable variant', () => {
  it('renders a plain, non-interactive card when onClick is omitted', () => {
    render(<MetricCard title="На проверке" value="0" delta="очередь пуста" />)
    // No button role → the tile is not keyboard/click actionable.
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('На проверке')).toBeTruthy()
  })

  it('renders a button and fires onClick when provided (links to the review flow)', () => {
    const onClick = vi.fn()
    render(<MetricCard title="На проверке" value="3" delta="требует действий" onClick={onClick} />)

    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    fireEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('still shows title / value / delta in the actionable variant', () => {
    render(<MetricCard title="На проверке" value="3" delta="требует действий" onClick={() => {}} />)
    expect(screen.getByText('На проверке')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('требует действий')).toBeTruthy()
  })
})
