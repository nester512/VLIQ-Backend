import type { CSSProperties } from 'react'

interface SkeletonProps {
  className?: string
  style?: CSSProperties
}

/**
 * Pulsing skeleton bone with a shimmer sweep.
 * Uses `vliq-shimmer` (CSS keyframe in index.css) which respects
 * `prefers-reduced-motion: reduce` via the global media query there.
 */
export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={['rounded-[10px] vliq-shimmer', className].join(' ')}
      style={style}
      aria-hidden
    />
  )
}

/** Pre-built MetricCard skeleton — mirrors the real MetricCard footprint
 *  (16px padding, 12px title height, 24px value, 12px delta). */
export function MetricCardSkeleton() {
  return (
    <div className="vliq-card vliq-metric-card-skel">
      <Skeleton className="h-3 w-20 mb-2" />
      <Skeleton className="h-6 w-24 mb-1.5" />
      <Skeleton className="h-3 w-16" />
    </div>
  )
}

/** Row skeleton that looks like an actual .vliq-row: 40px avatar, two text
 *  lines, trailing pill. Matches what users will see once data lands. */
export function RowSkeleton() {
  return (
    <div className="vliq-row is-static">
      <Skeleton className="w-10 h-10 rounded-[13px] flex-none" />
      <div className="flex-1 min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton className="h-3.5 w-3/5" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full flex-none" />
    </div>
  )
}

/** Receipt list row skeleton — same footprint as ReceiptRow (icon, title +
 *  subtitle, trailing amount + status pill). */
export function ReceiptRowSkeleton() {
  return (
    <div className="vliq-row is-static">
      <Skeleton className="w-10 h-10 rounded-[13px] flex-none" />
      <div className="flex-1 min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-2.5 w-1/3" />
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
    </div>
  )
}

/** Hero-sized skeleton that matches HeroBalance height (~130–150px). */
export function HeroSkeleton() {
  return (
    <div className="vliq-hero-skel">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-9 w-40" />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Skeleton className="h-8 w-32 rounded-[12px]" />
        <Skeleton className="h-8 w-24 rounded-[10px]" />
      </div>
    </div>
  )
}

/** Profile user-card skeleton (avatar + name/subtitle lines). */
export function ProfileCardSkeleton() {
  return (
    <div
      className="vliq-card"
      style={{ padding: 20, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}
    >
      <Skeleton className="w-[54px] h-[54px] rounded-[16px] flex-none" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
    </div>
  )
}
