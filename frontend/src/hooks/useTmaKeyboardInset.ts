import { useEffect, useRef } from 'react'

/**
 * Height (px) below which a visual-viewport shrink is treated as "no keyboard".
 * Small deltas come from safe-area / chrome rounding; without a floor the sheets
 * would jitter on incidental sub-pixel changes.
 */
export const KEYBOARD_MIN_PX = 80

/**
 * Pure computation of the software-keyboard inset, in CSS px.
 *
 * `layoutHeight` is the LAYOUT viewport height (`window.innerHeight`) — on iOS it
 * does NOT shrink when the keyboard opens. `vvHeight` / `vvOffsetTop` come from
 * `window.visualViewport`: the visual viewport is what iOS actually shrinks + pans
 * for the keyboard. The keyboard overlays the gap between the bottom of the visual
 * viewport and the bottom of the layout viewport:
 *   layoutHeight - vvHeight - vvOffsetTop
 * Sub-threshold or negative results mean no keyboard.
 */
export function keyboardInsetPx(
  layoutHeight: number,
  vvHeight: number,
  vvOffsetTop: number,
): number {
  const diff = layoutHeight - vvHeight - vvOffsetTop
  return diff >= KEYBOARD_MIN_PX ? Math.round(diff) : 0
}

/**
 * Publishes `--tma-kbd-inset` on <html> — the height the software keyboard
 * currently overlays — and cancels the iOS "scroll the page up to reveal the
 * focused input" pan.
 *
 * WHY (iOS-only bug — "вёрстка улетает вверх"): bottom sheets are
 * `position: fixed; bottom: 0`, anchored to the LAYOUT viewport. iOS does NOT
 * shrink the layout viewport for the keyboard — it overlays it and pans the
 * VISUAL viewport, so the sheet ends up behind the keyboard and iOS scrolls the
 * whole fixed layer up under the Telegram header. Sheets read `--tma-kbd-inset`
 * to lift their bottom edge exactly to the top of the keyboard (the input stays
 * visible → iOS has no reason to pan), and the `scrollTo(0, 0)` guard nulls any
 * residual pan.
 *
 * SIGNAL CHOICE: `window.visualViewport` is the API that actually reflects the
 * iOS software keyboard (the Telegram SDK viewport signals do not — they track
 * the Mini App window height, which iOS keeps constant under the keyboard). This
 * is also the API vaul itself uses for keyboard handling. The hook is self-
 * contained: where `visualViewport` is absent (old browser / SSR) it no-ops and
 * `--tma-kbd-inset` stays at its `0px` CSS default, so desktop/dev is unaffected.
 */
export function useTmaKeyboardInset(): void {
  const prevInset = useRef(0)

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return

    const apply = () => {
      const inset = keyboardInsetPx(window.innerHeight, vv.height, vv.offsetTop)
      document.documentElement.style.setProperty('--tma-kbd-inset', `${inset}px`)
      // Undo the iOS keyboard pan: on the closed→open edge, and any time the page
      // did get panned (offsetTop > 0). The document itself isn't user-scrollable
      // (body overflow is hidden), so a non-zero window scroll is always the pan.
      if (inset > 0 && (prevInset.current === 0 || vv.offsetTop > 0)) {
        window.scrollTo(0, 0)
      }
      prevInset.current = inset
    }

    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      document.documentElement.style.removeProperty('--tma-kbd-inset')
    }
  }, [])
}
