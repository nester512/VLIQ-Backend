import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { fmtMoney } from '@/utils/formatMoney'

interface TopSeller {
  telegram_id?: number
  name: string
  city: string
  receipts: string
  /** UC-01 — сумма продаж (наших товаров) и сумма выплат по продавцу. */
  sales?: number
  paid?: number
}

interface TopSellersBoardProps {
  sellers: TopSeller[]
  /** Items to show in the collapsed state (top of the dashboard). */
  collapsedCount?: number
  onSelect?: (s: TopSeller) => void
}

const MEDAL: Record<number, string> = { 1: '#F5B301', 2: '#9AA7B5', 3: '#CD7F32' }

function rankColor(rank: number): string {
  return MEDAL[rank] ?? 'var(--vliq-hint)'
}

function Row({ rank, seller, onClick }: { rank: number; seller: TopSeller; onClick?: () => void }) {
  const color = rankColor(rank)
  return (
    <button type="button" onClick={onClick} className="vliq-row">
      <div
        className="vliq-row-ic"
        style={{
          background: `color-mix(in srgb, ${color} 22%, transparent)`,
          color,
          fontWeight: 800,
          fontSize: 15,
        }}
      >
        {rank}
      </div>
      <div className="vliq-row-tx">
        <b>{seller.name}</b>
        <span>{[seller.city, seller.receipts].filter(Boolean).join(' · ')}</span>
      </div>
      <div style={{ flex: 'none', textAlign: 'right', marginRight: 4, minWidth: 96 }}>
        {seller.sales != null && (
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--vliq-text)', fontVariantNumeric: 'tabular-nums' }}>
            {fmtMoney(seller.sales)}
          </div>
        )}
        {seller.paid != null && (
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--vliq-hint)', fontVariantNumeric: 'tabular-nums' }}>
            выпл. {fmtMoney(seller.paid)}
          </div>
        )}
      </div>
    </button>
  )
}

/**
 * Top sellers — collapsed view shows the top N. Tapping "Показать всех"
 * (or scrolling down inside the dashboard) expands the inline list to the
 * full leaderboard; the "Свернуть" button collapses it again.
 *
 * The expanded state is a pure inline expansion (no portal / fullscreen
 * overlay) — that way Telegram's native scroll keeps working and the
 * back-button gesture closes the page, not just the panel.
 */
export function TopSellersBoard({
  sellers, collapsedCount = 3, onSelect,
}: TopSellersBoardProps) {
  const [expanded, setExpanded] = useState(false)
  const expandRef = useRef<HTMLDivElement>(null)
  const collapseRef = useRef<HTMLButtonElement>(null)
  const userToggledRef = useRef(false)

  // After a user toggle, gently scroll the toggle button into view — on
  // expand the new rows sit above the tabbar, on collapse the section
  // header is what the user wants back. Skipped on initial mount so the
  // dashboard doesn't auto-jump mid-page.
  useEffect(() => {
    if (!userToggledRef.current) return
    const ref = expanded ? collapseRef.current : expandRef.current
    requestAnimationFrame(() => {
      ref?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [expanded])

  const visible = expanded ? sellers : sellers.slice(0, collapsedCount)

  const buttonStyle: CSSProperties = {
    width: '100%',
    background: 'var(--vliq-field)',
    color: 'var(--vliq-brand)',
    fontWeight: 700,
    fontSize: 14,
    padding: '14px 16px',
    border: 0,
    cursor: 'pointer',
    textAlign: 'center',
    // The vliq-list pseudo-divider sits at z 0; lift the button so clicks
    // never get absorbed by it.
    position: 'relative',
    zIndex: 1,
  }

  return (
    <div ref={expandRef}>
      <div className="vliq-list">
        {visible.map((s, i) => (
          <Row
            key={`${s.telegram_id ?? i}`}
            rank={i + 1}
            seller={s}
            onClick={() => onSelect?.(s)}
          />
        ))}
        {sellers.length > collapsedCount && (
          <button
            ref={collapseRef}
            type="button"
            onClick={() => { userToggledRef.current = true; setExpanded((v) => !v) }}
            style={buttonStyle}
          >
            {expanded ? 'Свернуть' : `Показать всех (${sellers.length})`}
          </button>
        )}
      </div>
    </div>
  )
}
