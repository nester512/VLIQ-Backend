import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { keyboardInsetPx, useTmaKeyboardInset, KEYBOARD_MIN_PX } from './useTmaKeyboardInset'

describe('keyboardInsetPx', () => {
  it('returns 0 when the visual viewport fills the layout viewport (no keyboard)', () => {
    expect(keyboardInsetPx(844, 844, 0)).toBe(0)
  })

  it('ignores sub-threshold deltas (safe-area / rounding jitter)', () => {
    expect(keyboardInsetPx(844, 844 - (KEYBOARD_MIN_PX - 1), 0)).toBe(0)
  })

  it('returns the rounded overlay once the delta clears the floor', () => {
    expect(keyboardInsetPx(844, 844 - KEYBOARD_MIN_PX, 0)).toBe(KEYBOARD_MIN_PX)
    expect(keyboardInsetPx(844, 500, 0)).toBe(344)
  })

  it('subtracts the iOS pan offset (offsetTop) from the overlay', () => {
    // Keyboard 300px, page panned up 44px → remaining bottom gap 300-44 = 256.
    expect(keyboardInsetPx(844, 544, 44)).toBe(256)
  })

  it('never returns a negative inset', () => {
    expect(keyboardInsetPx(844, 900, 0)).toBe(0)
  })
})

describe('useTmaKeyboardInset', () => {
  // Mutable fake visualViewport whose handlers we can fire on demand.
  type VvEvent = 'resize' | 'scroll'
  const handlers: Record<VvEvent, Array<() => void>> = { resize: [], scroll: [] }
  const vv = {
    height: 844,
    offsetTop: 0,
    addEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'resize' || type === 'scroll') handlers[type].push(fn)
    }),
    removeEventListener: vi.fn((type: string, fn: () => void) => {
      if (type === 'resize' || type === 'scroll') {
        handlers[type] = handlers[type].filter((h) => h !== fn)
      }
    }),
  }
  const fire = (type: VvEvent) => act(() => { handlers[type].forEach((h) => h()) })

  beforeEach(() => {
    handlers.resize = []
    handlers.scroll = []
    vv.height = 844
    vv.offsetTop = 0
    vv.addEventListener.mockClear()
    vv.removeEventListener.mockClear()
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    window.scrollTo = vi.fn()
    document.documentElement.style.removeProperty('--tma-kbd-inset')
  })

  afterEach(() => {
    document.documentElement.style.removeProperty('--tma-kbd-inset')
  })

  const getVar = () => document.documentElement.style.getPropertyValue('--tma-kbd-inset')

  it('publishes 0px and does not scroll when no keyboard is open', () => {
    renderHook(() => useTmaKeyboardInset())
    expect(getVar()).toBe('0px')
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('reacts to the keyboard opening: publishes the inset and pins scroll once', () => {
    renderHook(() => useTmaKeyboardInset())
    // Keyboard opens → visual viewport shrinks.
    vv.height = 500
    fire('resize')
    expect(getVar()).toBe('344px')
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)

    // Keyboard grows a bit more while STILL open (predictive bar) — no new edge,
    // page not panned → must NOT re-pin (don't fight the user).
    vv.height = 480
    fire('resize')
    expect(getVar()).toBe('364px')
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
  })

  it('re-pins scroll if iOS pans the page while the keyboard is up', () => {
    renderHook(() => useTmaKeyboardInset())
    vv.height = 500
    fire('resize')
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
    // iOS panned the page up (offsetTop grows) — undo it.
    vv.offsetTop = 40
    fire('scroll')
    expect(window.scrollTo).toHaveBeenCalledTimes(2)
  })

  it('publishes 0px again when the keyboard closes', () => {
    renderHook(() => useTmaKeyboardInset())
    vv.height = 500
    fire('resize')
    expect(getVar()).toBe('344px')
    vv.height = 844
    fire('resize')
    expect(getVar()).toBe('0px')
  })

  it('removes the CSS var and its listeners on unmount', () => {
    const { unmount } = renderHook(() => useTmaKeyboardInset())
    vv.height = 500
    fire('resize')
    expect(getVar()).toBe('344px')
    unmount()
    expect(getVar()).toBe('')
    expect(vv.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(vv.removeEventListener).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
