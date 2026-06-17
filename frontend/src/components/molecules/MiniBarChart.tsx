import { useId } from 'react'

interface MiniBarChartProps {
  /** Real per-bar values (e.g. receipt counts). */
  data: number[]
  /** Y-axis top value; bars scale to this. Defaults to max(data, 1). */
  max?: number
  startLabel: string
  endLabel: string
  /** Pixel height of the plot area (excludes axis labels). */
  height?: number
  /** Caption shown between start/end on the x-axis. Defaults to nothing. */
  middleLabel?: string
}

const Y_GUTTER = 22 // px reserved for the y-axis value labels
const Y_GAP = 8     // px between the y-axis labels and the plot

/**
 * Small SVG bar chart for the admin dashboard «Динамика чеков».
 *
 * Shows real magnitudes on the y-axis (top / mid / 0 value ticks aligned to the
 * gridlines) and the period on the x-axis (start / middle / end calendar dates),
 * so the chart is actually readable — bars alone don't say "how many" or "when".
 */
export function MiniBarChart({
  data,
  max,
  startLabel,
  endLabel,
  height = 112,
  middleLabel,
}: MiniBarChartProps) {
  const uid = useId()
  const yMax = Math.max(max ?? Math.max(...data, 1), 1)
  const w = 100
  const h = 100
  const barCount = data.length
  // Spacing model: total width = bars + gaps; gap is ~ 28% of a bar.
  const gapRatio = 0.28
  const barW = w / (barCount + (barCount - 1) * gapRatio)
  const gap = barW * gapRatio
  const gridLines = [0, 0.25, 0.5, 0.75, 1]
  // Y-axis value ticks (top → bottom), aligned to the top / middle / bottom
  // gridlines. Rounded because bucket counts are whole numbers. Drop the mid
  // tick when yMax is small so we never render a duplicate like [1, 1, 0].
  const yTicks = yMax <= 1 ? [yMax, 0] : [yMax, Math.round(yMax / 2), 0]

  return (
    <div>
      <div style={{ display: 'flex', gap: Y_GAP }}>
        {/* Y-axis value labels */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            height,
            minWidth: Y_GUTTER,
            textAlign: 'right',
            fontSize: 10,
            fontWeight: 600,
            color: 'var(--vliq-hint)',
            fontVariantNumeric: 'tabular-nums',
          }}
          aria-hidden
        >
          {yTicks.map((t, i) => (
            <span key={i} style={{ lineHeight: 1 }}>{t}</span>
          ))}
        </div>

        {/* Plot */}
        <div style={{ flex: 1, position: 'relative' }}>
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
              const ratio = v / yMax
              const barH = v > 0 ? Math.max(ratio * h, 2) : 0
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
        </div>
      </div>

      {/* X-axis date labels — offset to align with the plot, not the y-gutter. */}
      <div
        style={{
          marginLeft: Y_GUTTER + Y_GAP,
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
