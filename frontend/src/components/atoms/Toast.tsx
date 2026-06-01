import { useUiStore, type Toast as ToastData } from '../../store/uiStore'

const KIND_BG: Record<NonNullable<ToastData['kind']>, string> = {
  ok:   'var(--vliq-ok-ink)',
  dg:   'var(--vliq-dg-ink)',
  wn:   'var(--vliq-wn-ink)',
  info: 'var(--vliq-text)',
}

function ToastItem({ toast }: { toast: ToastData }) {
  const dismissToast = useUiStore((s) => s.dismissToast)
  return (
    <div
      role="alert"
      aria-live="polite"
      onClick={() => dismissToast(toast.id)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 18px',
        borderRadius: 13,
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)',
        maxWidth: 'min(420px, 92vw)',
        background: KIND_BG[toast.kind] ?? 'var(--vliq-text)',
        color: toast.kind === 'info' ? 'var(--vliq-bg)' : '#fff',
        animation: 'vliq-toast-in .22s ease',
      }}
    >
      {toast.icon && <span aria-hidden>{toast.icon}</span>}
      <span style={{ whiteSpace: 'normal', textAlign: 'center' }}>{toast.message}</span>
    </div>
  )
}

/**
 * Toast container — pinned to the top edge of the viewport, vertically
 * stacked, horizontally centred. Earlier revisions used a left-anchored
 * keyframe that slid in from the screen edge — confusingly weird on
 * iPhone-sized viewports.
 */
export function ToastContainer() {
  const toastQueue = useUiStore((s) => s.toastQueue)
  if (toastQueue.length === 0) return null

  return (
    <div
      aria-label="Уведомления"
      style={{
        // fixed (not absolute) — otherwise toasts are trapped under the vaul
        // sheet's z-stacking and invisible when any BottomSheet is open.
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {toastQueue.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  )
}
