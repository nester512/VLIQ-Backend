import type { CSSProperties } from 'react'

interface FilterOption {
  value: string
  label: string
}

interface FilterPillsProps {
  options: FilterOption[]
  value: string
  onChange: (v: string) => void
  className?: string
  style?: CSSProperties
}

/**
 * Horizontal segmented control of pill-shaped buttons.
 * Active pill = brand; inactive = card surface with subtle shadow (matches prototype).
 */
export function FilterPills({ options, value, onChange, className = '', style }: FilterPillsProps) {
  return (
    <div
      className={`no-scrollbar ${className}`}
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        overflowY: 'hidden',
        ...style,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '9px 14px',
              borderRadius: 999,
              border: 0,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.1px',
              background: active ? 'var(--vliq-brand)' : 'var(--vliq-card)',
              color: active ? '#fff' : 'var(--vliq-hint)',
              boxShadow: active ? '0 8px 18px -10px var(--vliq-brand)' : 'var(--vliq-shadow-sm)',
              transition: 'background-color .15s ease, color .15s ease',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
