import { useState, useEffect, useRef } from 'react'
import { Drawer } from 'vaul'

export interface EditBonusSheetProps {
  open: boolean
  onClose: () => void
  /** Called with amount in kopecks (integer). */
  onConfirm: (amountKopecks: number) => void
  isSubmitting?: boolean
  currentBonusKopecks?: number
}

function EditBonusForm({
  onClose,
  onConfirm,
  isSubmitting,
  currentBonusKopecks,
}: {
  onClose: () => void
  onConfirm: (amountKopecks: number) => void
  isSubmitting: boolean
  currentBonusKopecks?: number
}) {
  const defaultRubles =
    currentBonusKopecks != null ? String(currentBonusKopecks / 100) : ''
  const [value, setValue] = useState(defaultRubles)
  const inputRef = useRef<HTMLInputElement>(null)

  const parsed = parseFloat(value.replace(',', '.'))
  const isValid = !isNaN(parsed) && parsed >= 0 && parsed <= 999_999

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [])

  function handleConfirm() {
    if (!isValid || isSubmitting) return
    onConfirm(Math.round(parsed * 100))
  }

  return (
    <div
      style={{
        padding: '12px 16px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <h2
        style={{
          fontSize: 17,
          fontWeight: 800,
          color: 'var(--vliq-text)',
          margin: 0,
          letterSpacing: '-0.3px',
        }}
      >
        Изменить бонус
      </h2>

      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        disabled={isSubmitting}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Сумма в рублях, напр. 120.50"
        aria-label="Сумма бонуса в рублях"
        style={{
          width: '100%',
          background: 'var(--vliq-field)',
          border: 'none',
          borderRadius: 14,
          padding: '14px',
          fontSize: 16,
          fontWeight: 600,
          color: 'var(--vliq-text)',
          outline: 'none',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9, marginTop: 4 }}>
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          style={{
            padding: '14px 16px',
            borderRadius: 14,
            border: 'none',
            background: 'var(--vliq-field)',
            color: 'var(--vliq-text)',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'inherit',
            opacity: isSubmitting ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!isValid || isSubmitting}
          style={{
            padding: '14px 16px',
            borderRadius: 14,
            border: 'none',
            background: 'var(--vliq-ok)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: isValid && !isSubmitting ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            opacity: !isValid || isSubmitting ? 0.45 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {isSubmitting ? 'Сохранение…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}

export function EditBonusSheet({
  open,
  onClose,
  onConfirm,
  isSubmitting = false,
  currentBonusKopecks,
}: EditBonusSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-[70]"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
        />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed bottom-0 left-0 right-0 z-[71] outline-none"
          style={{
            maxHeight: '93dvh',
            background: 'var(--vliq-card)',
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Drawer.Title className="sr-only">Изменить бонус</Drawer.Title>
          <div
            aria-hidden
            style={{
              width: 42,
              height: 5,
              background: 'var(--vliq-sep)',
              borderRadius: 3,
              margin: '10px auto 4px',
              flexShrink: 0,
            }}
          />
          {open && (
            <EditBonusForm
              onClose={onClose}
              onConfirm={onConfirm}
              isSubmitting={isSubmitting}
              currentBonusKopecks={currentBonusKopecks}
            />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
