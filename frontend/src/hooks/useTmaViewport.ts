import { useEffect } from 'react'
import { useSignal, viewportStableHeight, isViewportMounted } from '@telegram-apps/sdk-react'

/**
 * Sets `--tma-height` on `<html>` to the stable Telegram viewport height.
 *
 * Two correctness notes:
 *
 * 1. **Hooks must be called unconditionally.** Earlier versions wrapped
 *    `useSignal` in `try/catch`, which violates the Rules of Hooks the moment
 *    the SDK init state changes between renders. Here we always call the
 *    hooks; the `apply` effect simply gates on whether the SDK has mounted.
 *
 * 2. **Initial flash.** `--tma-height` is seeded with `100dvh` in
 *    `index.css`; we only narrow it down once Telegram reports its real
 *    stable height. That keeps the chrome-aware sizing without a layout
 *    jump on the first paint.
 */
export function useTmaViewport(): void {
  const mounted = useSignal(isViewportMounted)
  const stableHeight = useSignal(viewportStableHeight)

  useEffect(() => {
    if (mounted && typeof stableHeight === 'number' && stableHeight > 0) {
      document.documentElement.style.setProperty('--tma-height', `${stableHeight}px`)
    }
  }, [mounted, stableHeight])
}
