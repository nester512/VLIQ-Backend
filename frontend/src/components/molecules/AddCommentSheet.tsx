import { useState, useEffect, useRef } from 'react'
import { Drawer } from 'vaul'

export interface AddCommentSheetProps {
  open: boolean
  onClose: () => void
  onConfirm: (text: string) => void
  isSubmitting?: boolean
}

function AddCommentForm({
  onClose,
  onConfirm,
  isSubmitting,
}: {
  onClose: () => void
  onConfirm: (text: string) => void
  isSubmitting: boolean
}) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const isValid = text.trim().length >= 1 && text.trim().length <= 2000

  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [])

  function handleConfirm() {
    if (!isValid || isSubmitting) return
    onConfirm(text.trim())
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
      <h2
        style={{
          fontSize: 17,
          fontWeight: 800,
          color: 'var(--vliq-text)',
          margin: 0,
          letterSpacing: '-0.3px',
        }}
      >
        Добавить комментарий
      </h2>

      <textarea
        ref={textareaRef}
        aria-label="Текст комментария"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={2000}
        disabled={isSubmitting}
        placeholder="Введите комментарий к чеку…"
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

      <div
        style={{
          fontSize: 11.5,
          fontWeight: 500,
          color: 'var(--vliq-hint)',
          textAlign: 'right',
          marginTop: -6,
        }}
      >
        {text.length} / 2000
      </div>

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
            background: 'var(--vliq-brand)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: isValid && !isSubmitting ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            opacity: !isValid || isSubmitting ? 0.45 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {isSubmitting ? 'Отправка…' : 'Отправить'}
        </button>
      </div>
    </div>
  )
}

export function AddCommentSheet({
  open,
  onClose,
  onConfirm,
  isSubmitting = false,
}: AddCommentSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-[70]"
          style={{ background: 'rgba(0,0,0,0.5)' }}
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
          <Drawer.Title className="sr-only">Добавить комментарий</Drawer.Title>
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
            <AddCommentForm
              onClose={onClose}
              onConfirm={onConfirm}
              isSubmitting={isSubmitting}
            />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
