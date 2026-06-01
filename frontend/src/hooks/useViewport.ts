/**
 * useViewport — returns the current responsive breakpoint.
 *
 * Breakpoints:
 *   mobile  < 768 px  (TMA phone, Telegram mobile client)
 *   tablet  768–1279 px  (iPad, tablet, Telegram desktop at ~800px)
 *   desktop ≥ 1280 px  (desktop browser, Telegram desktop wide)
 *
 * Uses `window.matchMedia` with listener updates so components re-render
 * on resize without polling.
 */

import { useState, useEffect } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'mobile'
  const w = window.innerWidth
  if (w >= 1280) return 'desktop'
  if (w >= 768) return 'tablet'
  return 'mobile'
}

export function useViewport(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint)

  useEffect(() => {
    const tabletMq  = window.matchMedia('(min-width: 768px)')
    const desktopMq = window.matchMedia('(min-width: 1280px)')

    function update() {
      setBp(getBreakpoint())
    }

    tabletMq.addEventListener('change', update)
    desktopMq.addEventListener('change', update)

    // Sync in case the window was resized between render and effect
    update()

    return () => {
      tabletMq.removeEventListener('change', update)
      desktopMq.removeEventListener('change', update)
    }
  }, [])

  return bp
}
