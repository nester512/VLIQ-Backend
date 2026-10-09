import { useQuery } from '@tanstack/react-query'
import { getAdminReceipt } from '@/api/admin'
import { useUiStore } from '@/store/uiStore'
import { RECEIPT_STATUS } from '@/utils/receiptStatus'
import { fmtMoney } from '@/utils/formatMoney'
import { formatDateTime } from '@/utils/formatDate'

/**
 * «Совпадает с чеком #N» — the receipt a duplicate signal points to: whose it is,
 * its status, when it came in and its bonus — so the admin compares without
 * remembering history (a new moderator sees what the old one saw). Tap → open it.
 */
export function DuplicateOf({ receiptId }: { receiptId: number }) {
  const openSheet = useUiStore((s) => s.openSheet)
  const { data: original, isError, isLoading } = useQuery({
    queryKey: ['admin', 'receipts', 'one', receiptId],
    queryFn: () => getAdminReceipt(receiptId),
    staleTime: 60_000,
    retry: false,
  })

  if (isLoading) return <span className="opacity-80"> (чек #{receiptId})</span>
  if (isError || !original) return <span className="opacity-80"> (чек #{receiptId} — удалён или недоступен)</span>

  const status = RECEIPT_STATUS[original.status]?.label ?? original.status
  const seller = original.seller_name ?? `продавец #${original.seller_id}`
  return (
    <span className="block mt-1.5" data-testid="duplicate-of">
      Совпадает с чеком #{original.id}: {seller} · {status} · загружен {formatDateTime(original.created_at)}
      {original.bonus_amount ? ` · бонус ${fmtMoney(original.bonus_amount)}` : ''}{' '}
      <button
        type="button"
        onClick={() => openSheet('detail', { receiptId: original.id, receipt: original })}
        className="underline font-bold bg-transparent border-0 p-0 cursor-pointer text-inherit"
      >
        Открыть
      </button>
    </span>
  )
}
