import { useState, useEffect, useRef } from 'react'
import { Drawer } from 'vaul'

export interface ReasonCopy {
  title: string
  placeholder: string
  confirmLabel: string
  submittingLabel: string
  quickPicks: readonly string[]
  /** Optional line under the title — what happens on confirm. */
  note?: string
}

export interface RejectReasonSheetProps {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  isSubmitting?: boolean
  /** Same sheet for every «only with a reason» action; defaults to receipt rejection. */
  copy?: Partial<ReasonCopy>
}

const DEFAULT_COPY: ReasonCopy = {
  title: 'Причина отклонения',
  placeholder: 'Опишите причину отклонения…',
  confirmLabel: 'Отклонить',
  submittingLabel: 'Отклонение…',
  quickPicks: ['Дубль чека', 'Чек не от продавца', 'Сумма не совпадает с QR'],
}

/**
 * Inner form — rendered as a child so it remounts (and resets state)
 * each time the sheet opens. Avoids setting state inside an effect.
 */
function RejectForm({
  onClose,
  onConfirm,
  isSubmitting,
  copy,
}: {
  onClose: () => void
  onConfirm: (reason: string) => void
  isSubmitting: boolean
  copy: ReasonCopy
}) {
  const [reason, setReason] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isValid = reason.replace(/\s/g, '').length >= 3

  // Auto-focus textarea when this component first mounts
  useEffect(() => {
    const t = setTimeout(() => {
      textareaRef.current?.focus()
    }, 120)
    return () => clearTimeout(t)
  }, [])

  function handleConfirm() {
    if (!isValid || isSubmitting) return
    onConfirm(reason.trim())
  }

  function handleQuickPick(text: string) {
    setReason(text)
    textareaRef.current?.focus()
  }

  return (
    <div
      style={{
        padding: '12px 16px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        overflowY: 'auto',
      }}
    >
      {/* Title */}
      <h2
        style={{
          fontSize: 17,
          fontWeight: 800,
          color: 'var(--vliq-text)',
          margin: 0,
          letterSpacing: '-0.3px',
        }}
      >
        {copy.title}
      </h2>
      {copy.note && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--vliq-hint)', lineHeight: 1.4 }}>{copy.note}</p>
      )}

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        aria-label="Причина"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={4}
        disabled={isSubmitting}
        placeholder={copy.placeholder}
        style={{
          width: '100%',
          resize: 'vertical',
          background: 'var(--vliq-field)',
          border: 'none',
          borderRadius: 14,
          padding: '12px 14px',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--vliq-text)',
          outline: 'none',
          fontFamily: 'inherit',
          lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      />

      {/* Quick-pick chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {copy.quickPicks.map((chip) => (
          <button
            key={chip}
            type="button"
            disabled={isSubmitting}
            onClick={() => handleQuickPick(chip)}
            style={{
              padding: '7px 13px',
              borderRadius: 20,
              border: 'none',
              background: 'var(--vliq-field)',
              color: 'var(--vliq-text)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'opacity 0.15s',
            }}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Action buttons */}
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
            background: 'var(--color-dg)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: isValid && !isSubmitting ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            opacity: !isValid || isSubmitting ? 0.45 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {isSubmitting ? copy.submittingLabel : copy.confirmLabel}
        </button>
      </div>
    </div>
  )
}

export function RejectReasonSheet({
  open,
  onClose,
  onConfirm,
  isSubmitting = false,
  copy,
}: RejectReasonSheetProps) {
  const text: ReasonCopy = { ...DEFAULT_COPY, ...copy }
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-[70]"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed bottom-0 left-0 right-0 z-[71] outline-none"
          style={{
            // Lift the sheet exactly above the Telegram software keyboard so
            // iOS doesn't scroll the whole fixed layer up (see useTmaKeyboardInset).
            bottom: 'var(--tma-kbd-inset, 0px)',
            maxHeight: 'min(93dvh, calc(var(--tma-height, 100dvh) - var(--tma-kbd-inset, 0px)))',
            background: 'var(--vliq-card)',
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Drawer.Title className="sr-only">{text.title}</Drawer.Title>

          {/* Grab handle */}
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

          {/* Render the form only while open so it remounts (resets) on reopen */}
          {open && (
            <RejectForm
              onClose={onClose}
              onConfirm={onConfirm}
              isSubmitting={isSubmitting}
              copy={text}
            />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
