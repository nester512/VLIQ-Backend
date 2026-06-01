import { useId, useMemo, useRef, useState } from 'react'
import type { City } from '@/api/cities'

interface CitySelectProps {
  cities: City[]
  value: string // selected city NAME (the form stores the name, not the id)
  onChange: (name: string) => void
  onBlur?: () => void
  loading?: boolean
  invalid?: boolean
  placeholder?: string
}

/**
 * Searchable city combobox. The project has no select/combobox primitive, so
 * this is a self-contained input + filterable list styled with the vliq tokens.
 *
 * The form value is only ever set by selecting an option, so `value` always
 * holds a dictionary name (or ''). Free text typed but not selected is dropped
 * on blur — this is what makes "город только из списка" enforceable.
 */
export function CitySelect({
  cities,
  value,
  onChange,
  onBlur,
  loading = false,
  invalid = false,
  placeholder = 'Начните вводить город',
}: CitySelectProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const listId = useId()
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // While open we show the live query; when closed we show the committed value.
  const display = open ? query : value

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q ? cities.filter((c) => c.name.toLowerCase().includes(q)) : cities
    return base.slice(0, 50)
  }, [cities, query])

  function commit(c: City) {
    onChange(c.name)
    setQuery('')
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        className="vliq-field-v"
        value={display}
        placeholder={loading ? 'Загрузка городов…' : placeholder}
        disabled={loading}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHighlight(0)
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          setHighlight(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setHighlight((h) => Math.min(h + 1, filtered.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === 'Enter' && open && filtered[highlight]) {
            e.preventDefault()
            commit(filtered[highlight])
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        onBlur={() => {
          // Delay close so an option's mousedown/click can register first.
          blurTimer.current = setTimeout(() => {
            setOpen(false)
            onBlur?.()
          }, 120)
        }}
      />
      {open && !loading && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: 'absolute',
            zIndex: 50,
            left: 0,
            right: 0,
            top: 'calc(100% + 4px)',
            maxHeight: 220,
            overflowY: 'auto',
            listStyle: 'none',
            margin: 0,
            padding: 4,
            background: 'var(--vliq-card)',
            borderRadius: 12,
            boxShadow: '0 10px 30px -10px rgba(0,0,0,.35)',
            border: '1px solid var(--vliq-sep)',
          }}
        >
          {filtered.length === 0 ? (
            <li style={{ padding: '10px 12px', color: 'var(--vliq-hint)', fontSize: 13 }}>Город не найден</li>
          ) : (
            filtered.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={c.name === value}
                // mousedown + preventDefault selects before the input blur fires.
                onMouseDown={(e) => {
                  e.preventDefault()
                  commit(c)
                }}
                onMouseEnter={() => setHighlight(i)}
                className="vliq-press"
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--vliq-text)',
                  background: i === highlight ? 'var(--vliq-field)' : 'transparent',
                }}
              >
                {c.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
