import { Drawer } from 'vaul'
import { useUiStore } from '@/store/uiStore'
import { NotifSheet } from '@/features/admin/sheets/NotifSheet'
import { ReceiptDetailSheet } from '@/features/admin/sheets/ReceiptDetailSheet'
import { SellerDetailSheet } from '@/features/admin/sheets/SellerDetailSheet'
import { PayoutDetailSheet } from '@/features/admin/sheets/PayoutDetailSheet'
import type { AdminReceipt } from '@/api/admin'
import type { PayoutRequest } from '@/types/models'

/**
 * Global bottom sheet — content varies by `useUiStore.activeSheet`.
 *
 * Sheet payload contracts:
 *   'detail'  → { receiptId: string; receipt?: AdminReceipt }
 *   'seller'  → { telegram_id: number }
 *   'payout'  → { payoutId: string; payout?: PayoutRequest }
 *   'notif'   → no payload
 */
export function BottomSheet() {
  const activeSheet = useUiStore((s) => s.activeSheet)
  const sheetPayload = useUiStore((s) => s.sheetPayload)
  const closeSheet = useUiStore((s) => s.closeSheet)

  const isOpen = activeSheet !== null

  function renderContent() {
    switch (activeSheet) {
      case 'notif':
        return <NotifSheet />

      case 'detail': {
        const p = sheetPayload as { receiptId: string; receipt?: AdminReceipt } | null
        return <ReceiptDetailSheet receiptId={p?.receiptId ?? null} receipt={p?.receipt} />
      }

      case 'seller': {
        const p = sheetPayload as { telegram_id: number } | null
        return <SellerDetailSheet telegram_id={p?.telegram_id ?? null} />
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
            // Auto-height — the sheet sizes to its content (capped at 93% of
            // the viewport). Without this, vaul stretches the sheet to fill
            // 93% and the empty space below the content reads as a dark slab.
            maxHeight: '93dvh',
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
          <div
            className="no-scrollbar"
            style={{ overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}
          >
            {renderContent()}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
