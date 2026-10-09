import { Drawer } from 'vaul'
import { useUiStore } from '@/store/uiStore'
import { NotifSheet } from '@/features/admin/sheets/NotifSheet'
import { ReceiptDetailSheet } from '@/features/admin/sheets/ReceiptDetailSheet'
import { PayoutDetailSheet } from '@/features/admin/sheets/PayoutDetailSheet'
import type { AdminReceipt } from '@/api/admin'
import type { PayoutRequest } from '@/types/models'

/**
 * Global bottom sheet — content varies by `useUiStore.activeSheet`.
 *
 * Sheet payload contracts:
 *   'detail'  → { receiptId: string; receipt?: AdminReceipt }
 *   'payout'  → { payoutId: string; payout?: PayoutRequest }
 *   'notif'   → no payload
 */
export function BottomSheet() {
  const activeSheet = useUiStore((s) => s.activeSheet)
  const sheetPayload = useUiStore((s) => s.sheetPayload)
  const closeSheet = useUiStore((s) => s.closeSheet)
  const backSheet = useUiStore((s) => s.backSheet)
  const depth = useUiStore((s) => s.sheetStack.length)

  const isOpen = activeSheet !== null

  function renderContent() {
    switch (activeSheet) {
      case 'notif':
        return <NotifSheet />

      case 'detail': {
        const p = sheetPayload as { receiptId: string; receipt?: AdminReceipt } | null
        return <ReceiptDetailSheet receiptId={p?.receiptId ?? null} receipt={p?.receipt} />
      }

      case 'payout': {
        const p = sheetPayload as { payoutId: string; payout?: PayoutRequest } | null
        return <PayoutDetailSheet payoutId={p?.payoutId ?? null} payout={p?.payout} />
      }

      default:
        return null
    }
  }

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(open) => { if (!open) closeSheet() }}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed bottom-0 left-0 right-0 mx-auto w-full max-w-[640px] md:max-w-3xl xl:max-w-5xl z-[61] outline-none"
          style={{
            // Lift the sheet above the Telegram software keyboard (see
            // useTmaKeyboardInset) so iOS doesn't scroll the fixed layer up.
            bottom: 'var(--tma-kbd-inset, 0px)',
            // Auto-height — the sheet sizes to its content (capped at 93% of
            // the viewport, minus any keyboard overlay). Without this, vaul
            // stretches the sheet to fill 93% and the empty space below the
            // content reads as a dark slab.
            maxHeight: 'min(93dvh, calc(var(--tma-height, 100dvh) - var(--tma-kbd-inset, 0px)))',
            // Card colour (not the page bg) so the sheet reads as a separate
            // elevated surface — was visible as a "washed-out slab" otherwise.
            background: 'var(--vliq-card)',
            borderTopLeftRadius: 26,
            borderTopRightRadius: 26,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Drawer.Title className="sr-only">Окно</Drawer.Title>
          {/* Grab handle */}
          <div
            aria-hidden
            style={{
              width: 42,
              height: 5,
              background: 'var(--vliq-sep)',
              borderRadius: 3,
              margin: '10px auto 4px',
              flex: 'none',
            }}
          />
          {depth > 0 && (
            <button
              type="button"
              onClick={backSheet}
              className="vliq-pad"
              style={{
                flex: 'none', textAlign: 'left', background: 'none', border: 0, padding: '2px 16px 6px',
                color: 'var(--vliq-brand)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              ← Назад
            </button>
          )}
          <div
            className="no-scrollbar"
            style={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}
          >
            {/* key: a sheet re-opened from the stack starts fresh (its own local state). */}
            <div key={depth}>{renderContent()}</div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
