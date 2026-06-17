import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Avatar } from '@/components/atoms/Avatar'
import { Pill } from '@/components/atoms/Pill'
import { Icon } from '@/components/atoms/Icon'
import { Btn } from '@/components/atoms/Btn'
import { Spinner } from '@/components/atoms/Spinner'
import { ReceiptGraphic } from '@/components/molecules/ReceiptGraphic'
import { EditBonusSheet } from '@/components/molecules/EditBonusSheet'
import { AddCommentSheet } from '@/components/molecules/AddCommentSheet'
import { BlockSellerSheet } from '@/components/molecules/BlockSellerSheet'
import { initialsFromName } from '@/utils/initials'
import { fmtMoney, fmtMoneyDelta } from '@/utils/formatMoney'
import { useUiStore } from '@/store/uiStore'
import { useSwipeAction } from '@/features/admin/hooks/useReviewQueue'
import { editReceiptBonus, addReceiptComment, blockSeller, deleteReceipt } from '@/api/admin'
import { extractApiError } from '@/api/client'
import type { AdminReceipt } from '@/api/admin'
import type { Receipt } from '@/types/models'

interface ReceiptDetailSheetProps {
  receiptId: string | null
  receipt?: AdminReceipt
}

/** One label/value cell in the 2-column "Распознанные данные" grid.
 *  `wide` spans both columns for long values (shop, address, ФН/ФД/ФП). */
function KV({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <div className="text-[11.5px] font-medium text-[var(--vliq-hint)] mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold text-[var(--vliq-text)] leading-snug break-words">{value}</div>
    </div>
  )
}

export function ReceiptDetailSheet({ receiptId, receipt }: ReceiptDetailSheetProps) {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const pushToast = useUiStore((s) => s.pushToast)
  const { mutate: swipe, isPending } = useSwipeAction()
  const queryClient = useQueryClient()

  // Sub-sheet visibility state
  const [editBonusOpen, setEditBonusOpen] = useState(false)
  const [addCommentOpen, setAddCommentOpen] = useState(false)
  const [blockSellerOpen, setBlockSellerOpen] = useState(false)

  // ---- Mutation: edit bonus ----
  const { mutate: doEditBonus, isPending: editBonusPending } = useMutation({
    mutationFn: ({ id, amountKopecks }: { id: string; amountKopecks: number }) =>
      editReceiptBonus(id, amountKopecks),
    onSuccess: () => {
      setEditBonusOpen(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] })
      pushToast('Сумма бонуса обновлена', 'ok')
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })

  // ---- Mutation: add comment ----
  const { mutate: doAddComment, isPending: addCommentPending } = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      addReceiptComment(id, text),
    onSuccess: () => {
      setAddCommentOpen(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] })
      pushToast('Комментарий добавлен', 'ok')
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })

  // ---- Mutation: block seller ----
  const { mutate: doBlockSeller, isPending: blockSellerPending } = useMutation({
    mutationFn: ({ telegram_id, reason }: { telegram_id: string; reason: string | null }) =>
      blockSeller(telegram_id, reason),
    onSuccess: () => {
      setBlockSellerOpen(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'sellers'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
      pushToast('Продавец заблокирован', 'dg')
      closeSheet()
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })

  // ---- Mutation: A6 soft-delete (processed receipts) ----
  const { mutate: doDelete, isPending: deletePending } = useMutation({
    mutationFn: (id: string) => deleteReceipt(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'receipts'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
      pushToast('Чек удалён', 'ok')
      closeSheet()
    },
    onError: (err: unknown) => {
      const { userMessage } = extractApiError(err)
      pushToast(userMessage, 'dg')
    },
  })

  if (!receipt || !receiptId) {
    return (
      <div className="px-4 pb-8 grid place-items-center py-12">
        <Spinner size={28} className="text-[var(--vliq-brand)]" />
      </div>
    )
  }

  const sellerName = receipt.seller_name ?? `Продавец #${receipt.seller_id}`
  const sellerStore = receipt.seller_store ?? '—'
  const dupStatus = receipt.duplicate_status ?? 'ok'
  const dupLabel = receipt.duplicate_label ?? 'Дублей нет'
  const fraudDetails =
    (receipt.fraud_signal?.[0]?.details) ??
    receipt.rejection_reason ??
    'Подозрительной активности не выявлено'

  const receiptForGraphic: Receipt = {
    ...receipt,
    id: receipt.id,
    seller_id: receipt.seller_id,
    status: receipt.status,
    shop_name: receipt.shop_name,
    amount: receipt.amount,
    bonus_amount: receipt.bonus_amount,
    created_at: receipt.created_at,
    items: receipt.items,
  }

  function handleAction(dir: 'approve' | 'reject') {
    swipe(
      { id: receiptId!, dir },
      {
        onSettled: () => closeSheet(),
      },
    )
  }

  const sellerTelegramId = String(receipt.seller_id)

  return (
    <>
      {/* Sheet sc: padding 6px 16px 16px (prototype: .sc) */}
      <div className="pt-[6px] vliq-pad pb-4">
        {/* Header */}
        <div className="flex items-center gap-[11px] mb-4 mt-1">
          <Avatar initials={initialsFromName(sellerName)} size={42} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-[17px]">Чек #{receipt.id}</div>
            <div className="text-[12.5px] text-[var(--vliq-hint)] font-medium">
              {sellerName} · {sellerStore}
            </div>
          </div>
          <Pill kind={dupStatus === 'ok' ? 'ok' : 'dg'}>
            {dupStatus === 'ok' ? (
              <Icon name="shield" size={12} />
            ) : (
              <Icon name="alert" size={12} />
            )}
            {dupLabel}
          </Pill>
        </div>

        {/* Receipt graphic */}
        <div
          className="relative h-[330px] rounded-[18px] grid place-items-center overflow-hidden mb-3.5"
          style={{ background: 'linear-gradient(160deg, #5a6172, #3d4350)' }}
        >
          <div className="scale-[1.18] rotate-[-2deg]">
            <ReceiptGraphic receipt={receiptForGraphic} />
          </div>
          <button
            type="button"
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/[0.16] text-white grid place-items-center backdrop-blur-sm"
            onClick={() => {
              if (receipt.file_url) window.open(receipt.file_url, '_blank', 'noopener,noreferrer')
              else pushToast('Фото чека недоступно', 'info')
            }}
            aria-label="Открыть фото на весь экран"
          >
            <Icon name="zoom" size={16} />
          </button>
        </div>

        {/* KV data — compact 2-column grid (less empty space, aligned, no overlap) */}
        <b className="text-[14px] font-bold block mb-1.5">Распознанные данные</b>
        <div className="bg-[var(--vliq-field)] rounded-[16px] p-4 sm:p-5 shadow-[var(--vliq-shadow-sm)] mb-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-4">
          <KV label="Пользователь" value={sellerName} />
          <KV
            label="Дата загрузки"
            value={new Intl.DateTimeFormat('ru-RU', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            }).format(new Date(receipt.created_at))}
          />
          <KV label="Сумма покупки" value={fmtMoney(receipt.amount)} />
          <KV label="Найдено товаров" value={receipt.items?.length != null ? String(receipt.items.length) : '—'} />
          <KV label="Магазин" value={receipt.shop_name ?? '—'} wide />
          <KV label="Адрес" value={receipt.shop_address ?? '—'} wide />
          <KV
            label="ФН / ФД / ФП"
            value={
              receipt.fn && receipt.fd && receipt.fp
                ? `${receipt.fn.slice(-6)} / ${receipt.fd} / ${receipt.fp.slice(-4)}`
                : '—'
            }
            wide
          />
        </div>

        {receipt.fn && receipt.fd && receipt.fp && (
          <button
            type="button"
            onClick={() => {
              const text = `${receipt.fn} / ${receipt.fd} / ${receipt.fp}`
              navigator.clipboard?.writeText(text)
                .then(() => pushToast('Номер скопирован', 'ok'))
                .catch(() => pushToast('Не удалось скопировать', 'dg'))
            }}
            className="flex items-center gap-2 mb-4 -mt-2 text-[var(--vliq-brand)] text-[13px] font-semibold bg-transparent border-0 cursor-pointer"
          >
            <Icon name="cmt" size={15} /> Скопировать ФН / ФД / ФП
          </button>
        )}

        {/* Items */}
        {receipt.items && receipt.items.length > 0 && (
          <>
            <b className="text-[14px] font-bold block mb-1.5">Товары</b>
            <div className="bg-[var(--vliq-field)] rounded-[16px] p-4 sm:p-5 shadow-[var(--vliq-shadow-sm)] mb-3">
              {/* Items reflow into 2 columns on wide screens instead of one tall list */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8">
                {receipt.items.map((item, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 py-2.5">
                    <span className="flex-1 min-w-0 text-[13px] text-[var(--vliq-text)] font-medium leading-snug break-words">
                      {item.name}
                    </span>
                    <span
                      className="flex-none text-[13px] font-semibold whitespace-nowrap"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {fmtMoney(item.price)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 pt-3 mt-2 border-t border-[var(--vliq-sep)]">
                <span className="text-[13px] font-bold">Сумма бонуса</span>
                <span
                  className="text-[14px] font-extrabold text-[var(--vliq-ok-ink)] whitespace-nowrap"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {receipt.bonus_amount != null ? fmtMoneyDelta(receipt.bonus_amount) : '—'}
                </span>
              </div>
            </div>
          </>
        )}

        {/* Warning / fraud signal */}
        <div
          className={[
            'flex gap-2 items-start rounded-[14px] px-4 py-3 mb-5 text-[13px] font-medium',
            dupStatus === 'ok'
              ? 'bg-[var(--vliq-ok-bg)] text-[var(--vliq-ok-ink)]'
              : 'bg-[var(--vliq-dg-bg)] text-[var(--vliq-dg-ink)]',
          ].join(' ')}
        >
          <Icon name={dupStatus === 'ok' ? 'shield' : 'alert'} size={16} className="flex-none mt-0.5" />
          <span>Комментарий системы: {fraudDetails}</span>
        </div>

        {/* State machine gate: approve/revise/reject ONLY when receipt is in_review.
            For terminal/non-actionable statuses we render a compact status badge
            so admin sees "already processed" without a clickable trap → no more 409. */}
        {receipt.status === 'on_review' ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
              padding: '16px 0 0',
            }}
          >
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleAction('approve')}
              className="flex flex-col items-center gap-[7px] py-[13px] px-[6px] rounded-[14px] text-[12.5px] font-bold leading-[1.2] bg-[var(--vliq-ok)] text-white border-0 cursor-pointer active:opacity-80 transition-opacity disabled:opacity-50"
            >
              <Icon name="check" size={20} />
              Одобрить
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleAction('reject')}
              className="flex flex-col items-center gap-[7px] py-[13px] px-[6px] rounded-[14px] text-[12.5px] font-bold leading-[1.2] bg-[var(--vliq-dg)] text-white border-0 cursor-pointer active:opacity-80 transition-opacity disabled:opacity-50"
            >
              <Icon name="x" size={20} />
              Отклонить
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '14px 16px',
                margin: '16px 0 4px',
                borderRadius: 14,
                background: 'var(--vliq-field)',
                color: 'var(--vliq-hint)',
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <Icon name="shield" size={16} />
              <span>Чек уже обработан — действия недоступны</span>
            </div>
            {/* A6 soft-delete — only for processed (Отклонён / Выплачен) receipts. */}
            {(receipt.status === 'rejected' || receipt.status === 'paid_out') && (
              <button
                type="button"
                disabled={deletePending}
                onClick={() => doDelete(receiptId)}
                className="flex items-center justify-center gap-2 w-full mt-2 py-[11px] rounded-[12px] text-[13px] font-semibold bg-[var(--vliq-dg-bg)] text-[var(--vliq-dg-ink)] border-0 cursor-pointer disabled:opacity-50"
              >
                <Icon name="x" size={16} /> Удалить чек
              </button>
            )}
          </>
        )}

        {/* Secondary actions: «Изменить бонус» only when there IS a bonus to edit
            (approved or on_review). «Комментарий» is always allowed (admin notes). */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: (receipt.status === 'on_review' || receipt.status === 'approved')
              ? '1fr 1fr'
              : '1fr',
            gap: 12,
            padding: '12px 0',
          }}
        >
          {(receipt.status === 'on_review' || receipt.status === 'approved') && (
            <button
              type="button"
              disabled={editBonusPending}
              onClick={() => setEditBonusOpen(true)}
              className="flex flex-col items-center gap-[7px] py-[13px] px-[6px] rounded-[14px] text-[12.5px] font-bold leading-[1.2] bg-[var(--vliq-field)] text-[var(--vliq-text)] border-0 cursor-pointer active:opacity-80 transition-opacity disabled:opacity-50"
            >
              <Icon name="edit" size={20} />
              Изменить бонус
            </button>
          )}
          <button
            type="button"
            disabled={addCommentPending}
            onClick={() => setAddCommentOpen(true)}
            className="flex flex-col items-center gap-[7px] py-[13px] px-[6px] rounded-[14px] text-[12.5px] font-bold leading-[1.2] bg-[var(--vliq-field)] text-[var(--vliq-text)] border-0 cursor-pointer active:opacity-80 transition-opacity disabled:opacity-50"
          >
            <Icon name="cmt" size={20} />
            Комментарий
          </button>
        </div>

        {/* Block user — T2 fix: mt-2 provides spacing above */}
        <div style={{ paddingBottom: 4 }}>
          <Btn
            variant="ghost"
            className="text-[var(--vliq-dg-ink)] w-full"
            disabled={blockSellerPending}
            loading={blockSellerPending}
            onClick={() => setBlockSellerOpen(true)}
          >
            <Icon name="block" size={18} />
            Заблокировать пользователя
          </Btn>
        </div>
      </div>

      {/* Inline sub-sheets rendered outside the scrollable area */}
      <EditBonusSheet
        open={editBonusOpen}
        onClose={() => setEditBonusOpen(false)}
        onConfirm={(amountKopecks) => {
          if (!receiptId) return
          doEditBonus({ id: receiptId, amountKopecks })
        }}
        isSubmitting={editBonusPending}
        currentBonusKopecks={receipt.bonus_amount}
      />

      <AddCommentSheet
        open={addCommentOpen}
        onClose={() => setAddCommentOpen(false)}
        onConfirm={(text) => {
          if (!receiptId) return
          doAddComment({ id: receiptId, text })
        }}
        isSubmitting={addCommentPending}
      />

      <BlockSellerSheet
        open={blockSellerOpen}
        onClose={() => setBlockSellerOpen(false)}
        onConfirm={(reason) => {
          doBlockSeller({ telegram_id: sellerTelegramId, reason })
        }}
        isSubmitting={blockSellerPending}
        sellerName={sellerName}
      />
    </>
  )
}
