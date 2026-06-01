import { useEffect, useRef, useState } from 'react'

function preferesReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Counts from 0 up to `target` with an ease-out cubic curve.
 * Uses requestAnimationFrame — no framer-motion import so bundle impact is zero.
 * Respects `prefers-reduced-motion: reduce` by returning `target` immediately.
 */
export function useCountUp(
  target: number,
  opts?: { durationMs?: number; respectReducedMotion?: boolean },
): number {
  const { durationMs = 600, respectReducedMotion = true } = opts ?? {}

  const skipAnimation = respectReducedMotion && preferesReducedMotion()

  // Lazy initial state: if reduced motion, start already at target so no
  // synchronous setState is ever called inside the effect.
  const [value, setValue] = useState<number>(() => (skipAnimation ? target : 0))
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (skipAnimation) {
      // No setState here — initial value already equals target.
      return
    }

    // Reset start time when target changes so we re-animate from current value.
    startRef.current = null

    const from = 0

    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp
      const elapsed = timestamp - startRef.current
      const progress = Math.min(elapsed / durationMs, 1)
      // ease-out cubic: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3)
      const next = Math.round(from + eased * (target - from))
      setValue(next)

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate)
      }
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs, skipAnimation])

  return value
}
