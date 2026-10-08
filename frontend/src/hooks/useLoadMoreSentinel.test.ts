import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLoadMoreSentinel } from './useLoadMoreSentinel'

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void

const created: Array<{ cb: Callback; disconnect: ReturnType<typeof vi.fn> }> = []

class FakeObserver {
  disconnect = vi.fn()
  cb: Callback
  constructor(cb: Callback) {
    this.cb = cb
    created.push({ cb, disconnect: this.disconnect })
  }
  observe() {}
}

afterEach(() => {
  created.length = 0
  vi.unstubAllGlobals()
})

function setup(initial: { enabled: boolean; loading: boolean }, loadMore = vi.fn()) {
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  const hook = renderHook(
    ({ enabled, loading }) => {
      const ref = useLoadMoreSentinel(enabled, loading, loadMore)
      if (!ref.current) ref.current = document.createElement('div')
      return ref
    },
    { initialProps: initial },
  )
  hook.rerender(initial) // ref is attached after the first render, like a mounted sentinel
  return { ...hook, loadMore }
}

describe('useLoadMoreSentinel', () => {
  it('loads the next page when the sentinel becomes visible', () => {
    const { loadMore } = setup({ enabled: true, loading: false })
    created.at(-1)!.cb([{ isIntersecting: true }])
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('does not re-create the observer when loading flips (no request loop on a failing page)', () => {
    const { rerender } = setup({ enabled: true, loading: false })
    const count = created.length
    rerender({ enabled: true, loading: true })
    rerender({ enabled: true, loading: false })
    expect(created.length).toBe(count)
  })

  it('ignores intersections while a page is loading', () => {
    const { rerender, loadMore } = setup({ enabled: true, loading: false })
    rerender({ enabled: true, loading: true })
    created.at(-1)!.cb([{ isIntersecting: true }])
    expect(loadMore).not.toHaveBeenCalled()
  })

  it('disconnects when disabled (e.g. after an error or on the last page)', () => {
    const { rerender } = setup({ enabled: true, loading: false })
    const obs = created.at(-1)!
    rerender({ enabled: false, loading: false })
    expect(obs.disconnect).toHaveBeenCalled()
  })
})
