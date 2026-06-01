import type { Promotion } from '@/types/models'

interface PromoCardProps {
  promotion: Promotion
  onClick?: () => void
}

const PROMO_GRADIENTS: Record<string, string> = {
  default: 'linear-gradient(135deg, #6C4CF0, #9B6BFF)',
  green:   'linear-gradient(135deg, #16B981, #0BA37A)',
  orange:  'linear-gradient(135deg, #F39A12, #E07B0A)',
  blue:    'linear-gradient(135deg, #2F8FED, #1A7BD4)',
}

export function PromoCard({ promotion, onClick }: PromoCardProps) {
  const gradient = promotion.gradient.startsWith('linear-gradient')
    ? promotion.gradient
    : PROMO_GRADIENTS[promotion.gradient] ?? PROMO_GRADIENTS['default']

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!onClick) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }
  return (
    <div
      onClick={onClick}
      onKeyDown={onKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={['vliq-promo-card', onClick ? 'vliq-press' : ''].join(' ').trim()}
      style={{ background: gradient, cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="vliq-promo-card__inner">
        {/* Tag badge — prototype .promo .ptag */}
        <span className="vliq-chip vliq-promo-card__tag">
          {promotion.tag}
        </span>
        <h3 className="vliq-promo-card__title">{promotion.title}</h3>
        <p className="vliq-promo-card__desc">{promotion.description}</p>
        <div className="vliq-promo-card__footer">
          <span>● Участвуете автоматически</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Подробнее
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.4}>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  )
}
