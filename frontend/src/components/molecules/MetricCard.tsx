import { useCountUp } from '@/hooks/useCountUp'

interface MetricCardProps {
  title: string
  value: string
  delta?: string
  deltaColor?: 'ok' | 'dg' | 'wn' | 'hint'
  className?: string
  /** When true and value is a parseable number, animate count-up on mount. */
  tween?: boolean
  /**
   * When provided, the whole card becomes an actionable button (e.g. the
   * "На проверке" tile links to the receipt-review flow). Left unset the card
   * stays a plain, non-interactive `<div>`.
   */
  onClick?: () => void
}

const deltaColorVar: Record<NonNullable<MetricCardProps['deltaColor']>, string> = {
  ok:   'var(--vliq-ok-ink)',
  dg:   'var(--vliq-dg-ink)',
  wn:   'var(--vliq-wn-ink)',
  hint: 'var(--vliq-hint)',
}

/**
 * Numeric tween sub-component — only mounted when `tween` is true and the
 * value is a parseable integer so the hook is always called unconditionally.
 */
function TweenedValue({ raw, style, title }: { raw: number; style: React.CSSProperties; title: string }) {
  const animatedRaw = useCountUp(raw)
  const display = new Intl.NumberFormat('ru-RU').format(animatedRaw)
  return (
    <div className="vliq-metric-card__value" style={style} title={title}>
      {display}
    </div>
  )
}

/**
 * Mirrors prototype `.mc` — stable CSS class handles border-radius/padding/shadow
 * so they are never dropped by Tailwind v4 JIT arbitrary-value pruning.
 * `clamp()` keeps values inside the rounded corners on narrow screens.
 */
export function MetricCard({
  title, value, delta, deltaColor: tone = 'hint', className = '', tween = false, onClick,
}: MetricCardProps) {
  const valueStyle: React.CSSProperties = { fontSize: 'clamp(18px, 6.4vw, 23px)' }
  const parsedNum = parseFloat(value.replace(/[^0-9.-]/g, ''))
  const canTween = tween && !isNaN(parsedNum)

  const body = (
    <>
      <div className="vliq-metric-card__title">{title}</div>
      {canTween ? (
        <TweenedValue raw={parsedNum} style={valueStyle} title={value} />
      ) : (
        <div className="vliq-metric-card__value" style={valueStyle} title={value}>
          {value}
        </div>
      )}
      {delta !== undefined && (
        <div
          className="vliq-metric-card__delta"
          style={{ color: deltaColorVar[tone] }}
        >
          {delta}
        </div>
      )}
    </>
  )

  const cardClass = `vliq-card vliq-metric-card vliq-themed ${className}`

  // Actionable variant — render a real <button> for keyboard/screen-reader
  // support, resetting the UA button styles the card CSS does not own.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cardClass}
        style={{ font: 'inherit', textAlign: 'left', width: '100%', cursor: 'pointer' }}
      >
        {body}
      </button>
    )
  }

  return <div className={cardClass}>{body}</div>
}
