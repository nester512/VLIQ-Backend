import type { ReactNode } from 'react'

interface QuickActionCardProps {
  icon: ReactNode
  title: string
  subtitle?: string
  /** CSS variable name driving the icon tint, e.g. "--vliq-brand", "--color-acc" */
  color: string
  onClick?: () => void
}

/**
 * Quick action grid tile — mirrors prototype `.q`.
 * Uses `.vliq-action-card` from index.css (stable CSS class) instead of
 * Tailwind arbitrary values like `p-[16px]` which Tailwind v4 JIT can
 * silently drop in production builds.
 */
export function QuickActionCard({ icon, title, subtitle, color, onClick }: QuickActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="vliq-action-card vliq-themed"
    >
      {/* Icon bubble — bg/color driven by the `color` CSS var */}
      <div
        className="vliq-action-card__icon"
        style={{
          background: `color-mix(in srgb, var(${color}) 14%, transparent)`,
          color: `var(${color})`,
        }}
      >
        {icon}
      </div>
      <b className="vliq-action-card__title">{title}</b>
      {subtitle && (
        <span className="vliq-action-card__subtitle">{subtitle}</span>
      )}
    </button>
  )
}
