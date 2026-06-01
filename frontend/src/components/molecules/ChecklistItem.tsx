interface ChecklistItemProps {
  label: string
  ok: boolean
}

export function ChecklistItem({ label, ok }: ChecklistItemProps) {
  return (
    <div className="flex gap-2.5 items-center py-[5px] text-[13.5px] font-medium">
      <div
        className={[
          'w-5 h-5 rounded-[6px] grid place-items-center flex-none',
          ok ? 'bg-[var(--vliq-ok-bg)] text-[var(--vliq-ok-ink)]' : 'bg-[var(--vliq-field)] text-[var(--vliq-hint)]',
        ].join(' ')}
      >
        {ok ? (
          <svg viewBox="0 0 24 24" width="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 10 17.5 19.5 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="10">
            <circle cx="12" cy="12" r="4" fill="currentColor" />
          </svg>
        )}
      </div>
      <span className={ok ? 'text-[var(--vliq-text)]' : 'text-[var(--vliq-hint)]'}>{label}</span>
    </div>
  )
}
