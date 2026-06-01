import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Spinner } from './Spinner'

type BtnVariant = 'primary' | 'ghost' | 'danger'
type BtnSize = 'md' | 'sm'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  size?: BtnSize
  loading?: boolean
  children: ReactNode
}

const variantClass: Record<BtnVariant, string> = {
  primary: '',
  ghost:   'is-ghost',
  danger:  '',
}

const sizeClass: Record<BtnSize, string> = {
  md: '',
  sm: 'is-sm',
}

/** Mirrors prototype `.btn` (plus `.ghost` / `.sm` modifiers) — see `.vliq-btn` in index.css. */
export function Btn({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  style,
  ...props
}: BtnProps) {
  const dangerStyle =
    variant === 'danger'
      ? { background: 'var(--color-dg)', boxShadow: '0 14px 26px -12px var(--color-dg)' }
      : undefined
  return (
    <button
      type="button"
      disabled={disabled ?? loading}
      className={['vliq-btn', variantClass[variant], sizeClass[size], className].join(' ')}
      style={{ ...(dangerStyle ?? {}), ...(style ?? {}) }}
      {...props}
    >
      {loading ? <Spinner size={18} /> : null}
      {children}
    </button>
  )
}
