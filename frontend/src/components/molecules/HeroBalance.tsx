import type { CSSProperties } from 'react'
import { Icon } from '@/components/atoms/Icon'
import { fmtMoney } from '@/utils/formatMoney'
import { useCountUp } from '@/hooks/useCountUp'

interface HeroBalanceProps {
  available: number
  pending?: number
  onWithdraw?: () => void
  label?: string
  actionLabel?: string
  /** Override the default 16px-all-sides margin (e.g. when nested in a `.pad`) */
  margin?: CSSProperties['margin']
  className?: string
}

/**
 * Hero balance card — mirrors prototype `.hero`. Default margin matches the
 * prototype's 16px on all sides; pages that nest the hero inside a `.pad`
 * container override via the `margin` prop.
 *
 * Uses stable CSS classes from index.css instead of Tailwind arbitrary values.
 * Numbers can be very long ("9 999 999 ₽" = ~11 chars). clamp() shrinks font.
 */
export function HeroBalance({
  available,
  pending,
  onWithdraw,
  label = 'Доступно к выплате',
  actionLabel = 'Вывести',
  margin,
  className = '',
}: HeroBalanceProps) {
  const tweened = useCountUp(available)
  const formatted = fmtMoney(tweened)
  return (
    <div className={`vliq-hero ${className}`} style={margin !== undefined ? { margin } : undefined}>
      {/* Label — prototype .hero .lbl{font-size:13px;opacity:.85;font-weight:600} */}
      <div className="vliq-hero__lbl">{label}</div>

      {/* Big amount — prototype .hero .big{font-size:38px;font-weight:800;letter-spacing:-1px} */}
      <div
        className="vliq-hero__big"
        style={{
          fontSize: 'clamp(28px, 9vw, 38px)',
          fontVariantNumeric: 'tabular-nums',
        }}
        title={formatted}
      >
        {formatted}
      </div>

      {/* Footer row — prototype .hero .foot{display:flex;justify-content:space-between;align-items:flex-end} */}
      <div className="vliq-hero__foot">
        {onWithdraw ? (
          <button
            type="button"
            onClick={onWithdraw}
            className="vliq-hero-chip"
            title={actionLabel}
          >
            <Icon name="cashout" size={18} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{actionLabel}</span>
          </button>
        ) : (
          <div />
        )}
        {pending !== undefined && pending > 0 && (
          <div className="vliq-hero__mini">
            <span>На проверке</span>
            <b
              style={{
                fontSize: 'clamp(14px, 4.6vw, 17px)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={fmtMoney(pending)}
            >
              {fmtMoney(pending)}
            </b>
          </div>
        )}
      </div>
    </div>
  )
}
