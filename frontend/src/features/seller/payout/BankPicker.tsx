import { useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { SearchBar } from '@/components/molecules/SearchBar'
import { Icon } from '@/components/atoms/Icon'
import { searchBanks, type SbpBank } from './bankSearch'

export const OTHER_BANK = 'other'

/** What the form holds: a bank from the list, or «Другое» with the name the seller types. */
export interface BankChoice {
  id: string
  name: string
}

interface BankPickerProps {
  banks: SbpBank[] | undefined
  loading: boolean
  value: BankChoice | null
  onChange: (choice: BankChoice) => void
}

/**
 * «Банк получателя» (UC-S7): a field that opens a tall sheet with search on top.
 * Empty search — «Популярные», then every bank А–Я, then «Другое». Nothing found —
 * one tap turns the typed text into «Другое» with that name.
 */
export function BankPicker({ banks, loading, value, onChange }: BankPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const found = useMemo(() => (banks && query.trim() ? searchBanks(banks, query) : null), [banks, query])
  const popular = useMemo(() => banks?.filter((b) => b.popular) ?? [], [banks])
  const rest = useMemo(() => banks?.filter((b) => !b.popular) ?? [], [banks])

  function pick(choice: BankChoice) {
    onChange(choice)
    setOpen(false)
    setQuery('')
  }

  const typed = query.trim().replace(/\s+/g, ' ')
  const label = value ? (value.id === OTHER_BANK ? 'Другое' : value.name) : ''

  return (
    <Drawer.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }} repositionInputs={false}>
      <Drawer.Trigger asChild>
        <button
          type="button"
          className="vliq-field"
          disabled={loading}
          data-testid="bank-picker"
          style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', marginTop: 12 }}
        >
          <label style={{ pointerEvents: 'none' }}>Банк получателя</label>
          <span className="vliq-field-v" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: label ? 'var(--vliq-text)' : 'var(--vliq-hint)', minWidth: 0 }}>
              {loading ? 'Загрузка списка банков…' : label || 'Выберите банк'}
            </span>
            <Icon name="chev" size={18} className="flex-none" />
          </span>
        </button>
      </Drawer.Trigger>
      {/* Mounted only while open: a picked bank closes the sheet at once, and nothing of it stays
          over the form (a closing sheet would keep the form hidden from screen readers). */}
      {open && <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60]" style={{ background: 'rgba(0,0,0,0.5)' }} />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed bottom-0 left-0 right-0 mx-auto w-full max-w-[640px] z-[61] outline-none"
          style={{
            bottom: 'var(--tma-kbd-inset, 0px)',
            // Always tall: the list must not jump while the seller types.
            height: 'min(88dvh, calc(var(--tma-height, 100dvh) - var(--tma-kbd-inset, 0px)))',
            background: 'var(--vliq-card)', borderTopLeftRadius: 26, borderTopRightRadius: 26,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <Drawer.Title className="sr-only">Банк получателя</Drawer.Title>
          <div aria-hidden style={{ width: 42, height: 5, background: 'var(--vliq-sep)', borderRadius: 3, margin: '10px auto 4px', flex: 'none' }} />
          <div style={{ flex: 'none', padding: '6px 16px 10px' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, margin: '2px 0 10px', color: 'var(--vliq-text)' }}>Банк получателя</h2>
            <SearchBar
              value={query}
              onChange={(v) => { setQuery(v); if (listRef.current) listRef.current.scrollTop = 0 }}
              placeholder="Название банка: сбер, тинькофф, альфа…"
              autoFocus
            />
          </div>
          <div ref={listRef} className="no-scrollbar" style={{ overflowY: 'auto', minHeight: 0, flex: 1, padding: '0 16px 16px' }}>
            {found === null ? (
              <>
                <Section title="Популярные" banks={popular} selected={value?.id} onPick={pick} />
                <Section title="Все банки СБП" banks={rest} selected={value?.id} onPick={pick} />
              </>
            ) : found.length > 0 ? (
              <Section title={`Найдено: ${found.length}`} banks={found} selected={value?.id} onPick={pick} />
            ) : (
              <div style={{ padding: '18px 4px 8px', color: 'var(--vliq-hint)', fontSize: 14 }} data-testid="bank-not-found">
                «{typed}» нет в списке банков СБП.
              </div>
            )}
            {found !== null && found.length === 0 && typed.length >= 2 ? (
              <OtherRow
                title={`Указать «${typed}»`}
                subtitle="Банка нет в списке — переведём по названию"
                onClick={() => pick({ id: OTHER_BANK, name: typed })}
              />
            ) : (
              <OtherRow
                title="Другое"
                subtitle="Банка нет в списке — напишите название"
                onClick={() => pick({ id: OTHER_BANK, name: value?.id === OTHER_BANK ? value.name : '' })}
              />
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>}
    </Drawer.Root>
  )
}

function Section({ title, banks, selected, onPick }: {
  title: string; banks: SbpBank[]; selected?: string; onPick: (c: BankChoice) => void
}) {
  if (!banks.length) return null
  return (
    <section style={{ marginTop: 6 }}>
      <h3 style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--vliq-hint)', margin: '10px 4px 6px' }}>
        {title}
      </h3>
      <div className="vliq-list" role="listbox" aria-label={title}>
        {banks.map((b) => (
          <button
            key={b.id}
            type="button"
            role="option"
            aria-selected={selected === b.id}
            className="vliq-row"
            onClick={() => onPick({ id: b.id, name: b.name })}
            style={{ padding: '11px 14px' }}
          >
            <span
              aria-hidden
              style={{
                width: 32, height: 32, borderRadius: 10, flex: 'none', display: 'grid', placeItems: 'center',
                background: 'color-mix(in srgb, var(--vliq-brand) 14%, transparent)', color: 'var(--vliq-brand)', fontWeight: 800, fontSize: 14,
              }}
            >
              {initial(b.name)}
            </span>
            <span style={{ flex: 1, minWidth: 0, textAlign: 'left', fontSize: 15, fontWeight: 600, color: 'var(--vliq-text)', whiteSpace: 'normal' }}>
              {b.name}
            </span>
            {selected === b.id && <Icon name="check" size={18} className="flex-none" />}
          </button>
        ))}
      </div>
    </section>
  )
}

function OtherRow({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <div className="vliq-list" style={{ marginTop: 14 }}>
      <button type="button" className="vliq-row" onClick={onClick} data-testid="bank-other" style={{ padding: '11px 14px' }}>
        <span aria-hidden style={{ width: 32, height: 32, borderRadius: 10, flex: 'none', display: 'grid', placeItems: 'center', background: 'var(--vliq-field)', color: 'var(--vliq-hint)', fontWeight: 800 }}>
          …
        </span>
        <span style={{ flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', flexDirection: 'column' }}>
          <b style={{ fontSize: 15, color: 'var(--vliq-text)', whiteSpace: 'normal' }}>{title}</b>
          <span style={{ fontSize: 12.5, color: 'var(--vliq-hint)', whiteSpace: 'normal' }}>{subtitle}</span>
        </span>
      </button>
    </div>
  )
}

/** First letter of the bank's own word: «Банк ВТБ» → «В», «АКБ АВАНГАРД» → «А». */
function initial(name: string): string {
  const skip = new Set(['банк', 'кб', 'акб', 'ао', 'пао', 'ооо', 'нко', 'пнко', 'рнко', 'ик', 'мс', 'аб'])
  const words = name.replace(/[«»"()]/g, ' ').split(/\s+/).filter(Boolean)
  const w = words.find((x) => !skip.has(x.toLowerCase())) ?? words[0] ?? '?'
  return w[0]!.toUpperCase()
}
