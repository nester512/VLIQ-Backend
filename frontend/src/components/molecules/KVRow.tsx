import type { ReactNode } from 'react'

interface KVRowProps {
  label: string
  value: ReactNode
  /** Optional inline-style override for the value side (color, font-size). */
  valueStyle?: React.CSSProperties
}

/**
 * Key/value row used inside detail sheets (receipt / seller / payout).
 * Last row drops its bottom border via `last:border-b-0`-equivalent CSS.
 */
export function KVRow({ label, value, valueStyle }: KVRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 16,
        padding: '11px 0',
        borderBottom: '1px solid var(--vliq-sep)',
        fontSize: 14,
      }}
      className="last:border-b-0"
    >
      <span style={{ color: 'var(--vliq-hint)', fontWeight: 500, flex: 'none' }}>{label}</span>
      <span
        style={{
          fontWeight: 700,
          textAlign: 'right',
          maxWidth: '60%',
          color: 'var(--vliq-text)',
          ...valueStyle,
        }}
      >
        {value}
      </span>
    </div>
  )
}
