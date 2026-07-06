import { PromoCard } from '@/components/molecules/PromoCard'
import { Skeleton } from '@/components/atoms/Skeleton'
import { Icon } from '@/components/atoms/Icon'
import { EmptyState } from '@/components/molecules/EmptyState'
import { usePromotions } from '../hooks/usePromotions'

// MVP decision: promotions are hidden, not deleted. Keep the screen/route and
// old implementation below so the feature can be restored after product rules
// and promotion mechanics are finalized.
const PROMO_MVP_PLACEHOLDER = true

/** Placeholder that mirrors a PromoCard's visual weight (gradient hero + rows). */
function PromoCardSkeleton() {
  return (
    <div style={{ margin: '0 16px 12px' }}>
      <Skeleton className="rounded-[20px]" style={{ height: 148 }} />
    </div>
  )
}

export function PromoPage() {
  return PROMO_MVP_PLACEHOLDER ? <PromoComingSoon /> : <PromoActualPage />
}

function PromoComingSoon() {
  return (
    <div className="vliq-pad" style={{ paddingTop: 14 }}>
      <EmptyState
        icon="gift"
        tone="brand"
        title="Раздел «Акции» будет доступен позже"
        description="Сумму бонуса за чек сейчас назначает администратор при проверке. Когда появятся акции — они будут здесь."
      />
    </div>
  )
}

function PromoActualPage() {
  const { data: promotions, isLoading } = usePromotions()
  const list = promotions ?? []

  return (
    <div style={{ paddingTop: 14 }}>
      {isLoading ? (
        <div className="vliq-promo-grid">
          <PromoCardSkeleton />
          <PromoCardSkeleton />
        </div>
      ) : list.length > 0 ? (
        <div className="vliq-promo-grid">
          {list.map((promo) => <PromoCard key={promo.id} promotion={promo} />)}
        </div>
      ) : (
        <div className="vliq-pad">
          <EmptyState
            icon="gift"
            tone="brand"
            title="Сейчас акций нет"
            description="Когда бренд запустит новую кампанию — она появится здесь."
          />
        </div>
      )}

      {/* Auto-participation note */}
      {list.length > 0 && (
        <div style={{ padding: '4px 16px 0' }}>
          <div
            className="vliq-card"
            style={{
              padding: 16,
              display: 'flex',
              gap: 12,
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 13,
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
                background: 'var(--vliq-brand)',
                color: '#fff',
              }}
            >
              <Icon name="gift" size={21} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--vliq-text)' }}>
                Участие без действий
              </b>
              <div style={{ fontSize: 12.5, color: 'var(--vliq-hint)', fontWeight: 500, marginTop: 2, lineHeight: 1.4 }}>
                Достаточно соответствовать условиям акции — бонус начислится сам
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
