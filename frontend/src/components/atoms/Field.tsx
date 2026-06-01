import type { InputHTMLAttributes, ReactNode } from 'react'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  error?: string
  hint?: string
  children?: ReactNode
  className?: string
}

/** Mirrors prototype `.field`. Adds an explicit error border so users see
 *  *which* field needs attention without reading the toast message. */
export function Field({
  label,
  error,
  hint,
  children,
  className = '',
  id,
  ...inputProps
}: FieldProps) {
  const fieldId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`
  const errorBorder = error
    ? { boxShadow: 'inset 0 0 0 1.5px var(--color-dg)' }
    : undefined

  return (
    <div className={`vliq-field ${className}`} style={errorBorder}>
      <label htmlFor={fieldId} style={error ? { color: 'var(--color-dg)' } : undefined}>
        {label}
      </label>
      {children ?? (
        <input
          id={fieldId}
          className="vliq-field-v"
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          aria-invalid={error ? true : undefined}
          {...inputProps}
        />
      )}
      {error && (
        <p id={`${fieldId}-error`} style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: 'var(--color-dg)' }}>
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={`${fieldId}-hint`} style={{ marginTop: 6, fontSize: 11.5, fontWeight: 500, color: 'var(--vliq-hint)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}
