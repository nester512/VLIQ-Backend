import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '@/components/atoms/Icon'

interface SearchBarProps {
  placeholder?: string
  value: string
  onChange: (v: string) => void
  className?: string
  style?: CSSProperties
}

export function SearchBar({
  placeholder = 'Поиск',
  value,
  onChange,
  className = '',
  style,
}: SearchBarProps) {
  const [focused, setFocused] = useState(false)

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        background: 'var(--vliq-field)',
        borderRadius: 13,
        padding: '11px 14px',
        color: 'var(--vliq-hint)',
        border: focused
          ? '1px solid var(--vliq-brand)'
          : '1px solid var(--vliq-sep)',
        boxShadow: focused
          ? '0 0 0 3px rgba(108, 76, 240, 0.16)'
          : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        ...style,
      }}
    >
      <Icon name="search" size={20} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          outline: 'none',
          border: 'none',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--vliq-text)',
        }}
      />
    </div>
  )
}
