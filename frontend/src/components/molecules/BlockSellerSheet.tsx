import { useState, useRef } from 'react'
import { Drawer } from 'vaul'

export interface BlockSellerSheetProps {
  open: boolean
  onClose: () => void
  /** Called with optional reason string (null if omitted). */
  onConfirm: (reason: string | null) => void
  isSubmitting?: boolean
  sellerName?: string
}

function BlockSellerForm({
  onClose,
  onConfirm,
  isSubmitting,
  sellerName,
}: {
  onClose: () => void
  onConfirm: (reason: string | null) => void
  isSubmitting: boolean
  sellerName?: string
}) {
  const [reason, setReason] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleConfirm() {
    if (isSubmitting) return
    onConfirm(reason.trim() || null)
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
          color: 'var(--vliq-dg-ink)',
          margin: 0,
          letterSpacing: '-0.3px',
        }}
      >
        Заблокировать продавца
      </h2>

      {sellerName && (
        <p
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--vliq-hint)',
            margin: 0,
          }}
        >
          {sellerName}
        </p>
      )}

      <textarea
        ref={textareaRef}
        aria-label="Причина блокировки (необязательно)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={3}
        maxLength={500}
        disabled={isSubmitting}
        placeholder="Причина блокировки (необязательно)…"
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
          disabled={isSubmitting}
          style={{
            padding: '14px 16px',
            borderRadius: 14,
            border: 'none',
            background: 'var(--color-dg)',
            color: '#fff',
            fontSize: 15,
            fontWeight: 700,
            cursor: isSubmitting ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            opacity: isSubmitting ? 0.45 : 1,
            transition: 'opacity 0.15s',
          }}
        >
          {isSubmitting ? 'Блокировка…' : 'Заблокировать'}
        </button>
      </div>
    </div>
  )
}

export function BlockSellerSheet({
  open,
  onClose,
  onConfirm,
  isSubmitting = false,
  sellerName,
}: BlockSellerSheetProps) {
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
          <Drawer.Title className="sr-only">Заблокировать продавца</Drawer.Title>
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
            <BlockSellerForm
              onClose={onClose}
              onConfirm={onConfirm}
              isSubmitting={isSubmitting}
              sellerName={sellerName}
            />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
