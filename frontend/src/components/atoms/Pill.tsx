import type { ReactNode } from 'react'

type PillKind = 'ok' | 'dg' | 'wn' | 'muted' | 'brand'

interface PillProps {
  kind?: PillKind
  children: ReactNode
  className?: string
}

/**
 * Status pill — uses `.vliq-pill` from index.css for stable padding/layout.
 * Color is driven by `--vliq-*` tokens so it adapts to Telegram themes.
 * Max-width + overflow: hidden ensure it never escapes a card's border-radius.
 */
const kindClass: Record<PillKind, string> = {
  ok:    'vliq-pill--ok',
  dg:    'vliq-pill--dg',
  wn:    'vliq-pill--wn',
  muted: 'vliq-pill--muted',
  brand: 'vliq-pill--brand',
}

export function Pill({ kind = 'muted', children, className = '' }: PillProps) {
  return (
    <span
      className={['vliq-pill', kindClass[kind], className].join(' ')}
      style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}
    >
      {children}
    </span>
  )
}
