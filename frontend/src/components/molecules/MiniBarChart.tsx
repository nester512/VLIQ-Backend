import { useId } from 'react'

interface MiniBarChartProps {
  data: number[]
  startLabel: string
  endLabel: string
  /** Pixel height of the plot area (excludes axis labels). */
  height?: number
  /** Caption shown alongside the start/end labels. Defaults to nothing. */
  middleLabel?: string
}

/**
 * Placeholder chart for the admin dashboard.
 *
 * The bars are rendered as SVG so the same component can be swapped 1:1 with
 * a real time-series chart later — we keep the gridlines, axis labels and
 * tooltip slot so the visual footprint doesn't jump when real data arrives.
 */
export function MiniBarChart({
  data,
  startLabel,
  endLabel,
  height = 112,
  middleLabel,
}: MiniBarChartProps) {
  const uid = useId()
  const max = Math.max(...data, 1)
  const w = 100
  const h = 100
  const barCount = data.length
  // Spacing model: total width = bars + gaps; gap is ~ 28% of a bar.
  const gapRatio = 0.28
  const barW = w / (barCount + (barCount - 1) * gapRatio)
  const gap = barW * gapRatio
  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div style={{ position: 'relative' }}>
      {/* gridlines */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
        aria-hidden
      >
        <defs>
          <linearGradient id={`barGrad-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="var(--vliq-brand)"   stopOpacity="0.95" />
            <stop offset="100%" stopColor="var(--vliq-brand-2)" stopOpacity="0.85" />
          </linearGradient>
        </defs>

        {gridLines.map((g) => (
          <line
            key={g}
            x1="0" x2={w}
            y1={h - g * h} y2={h - g * h}
            stroke="var(--vliq-sep)"
            strokeWidth={0.4}
            strokeDasharray={g === 0 ? '0' : '1 2'}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {data.map((v, i) => {
          const ratio = v / max
          const barH = Math.max(ratio * h, 2)
          const x = i * (barW + gap)
          const y = h - barH
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barW}
              height={barH}
              fill={`url(#barGrad-${uid})`}
              rx={Math.min(barW * 0.18, 1.4)}
              ry={Math.min(barW * 0.18, 1.4)}
            />
          )
        })}
      </svg>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 10,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--vliq-hint)',
        }}
      >
        <span>{startLabel}</span>
        {middleLabel ? <span>{middleLabel}</span> : null}
        <span>{endLabel}</span>
      </div>
    </div>
  )
}
