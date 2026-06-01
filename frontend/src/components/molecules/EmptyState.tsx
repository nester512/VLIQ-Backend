import type { ReactNode } from 'react'
import { Icon } from '@/components/atoms/Icon'

type IconName = Parameters<typeof Icon>[0]['name']
type Tone = 'brand' | 'ok' | 'wn' | 'dg' | 'muted'

interface EmptyStateProps {
  icon: IconName
  title: string
  description?: string
  tone?: Tone
  action?: ReactNode
}

const TONE: Record<Tone, { bg: string; ink: string }> = {
  brand:  { bg: 'color-mix(in srgb, var(--vliq-brand) 14%, transparent)', ink: 'var(--vliq-brand)' },
  ok:     { bg: 'var(--vliq-ok-bg)',  ink: 'var(--vliq-ok-ink)' },
  wn:     { bg: 'var(--vliq-wn-bg)',  ink: 'var(--vliq-wn-ink)' },
  dg:     { bg: 'var(--vliq-dg-bg)',  ink: 'var(--vliq-dg-ink)' },
  muted:  { bg: 'var(--vliq-field)',  ink: 'var(--vliq-hint)' },
}

/**
 * Friendly empty/zero state inside a card. Always full-width — pages decide
 * the surrounding padding. Uses stable CSS class instead of inline padding.
 */
export function EmptyState({ icon, title, description, tone = 'muted', action }: EmptyStateProps) {
  const t = TONE[tone]
  return (
    <div className="vliq-card vliq-empty-state">
      <div
        style={{
          width: 64, height: 64,
          borderRadius: 20,
          display: 'grid', placeItems: 'center',
          margin: '0 auto 14px',
          background: t.bg,
          color: t.ink,
        }}
      >
        <Icon name={icon} size={28} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--vliq-text)' }}>{title}</div>
      {description && (
        <p
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--vliq-hint)',
            marginTop: 6,
            lineHeight: 1.45,
            maxWidth: 280,
            marginInline: 'auto',
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}
