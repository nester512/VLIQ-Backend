import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/atoms/Icon'
import { Btn } from '@/components/atoms/Btn'
import { Spinner } from '@/components/atoms/Spinner'
import { ReceiptGraphic } from '@/components/molecules/ReceiptGraphic'
import { ReceiptInfoCard } from '@/components/molecules/ReceiptInfoCard'
import { AttachmentViewer } from '@/components/organisms/AttachmentViewer'
import { EditBonusSheet } from '@/components/molecules/EditBonusSheet'
import { RejectReasonSheet } from '@/components/molecules/RejectReasonSheet'
import { AddCommentSheet } from '@/components/molecules/AddCommentSheet'
import { BlockSellerSheet } from '@/components/molecules/BlockSellerSheet'
import { useUiStore } from '@/store/uiStore'
import { useSwipeAction } from '@/features/admin/hooks/useReviewQueue'
import { editReceiptBonus, addReceiptComment, blockSeller, deleteReceipt } from '@/api/admin'
import { extractApiError } from '@/api/client'
import type { AdminReceipt } from '@/api/admin'

interface ReceiptDetailSheetProps {
  receiptId: string | null
  receipt?: AdminReceipt
}

export function ReceiptDetailSheet({ receiptId, receipt }: ReceiptDetailSheetProps) {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const openSheet = useUiStore((s) => s.openSheet)
  const pushToast = useUiStore((s) => s.pushToast)
  const { mutate: swipe, isPending } = useSwipeAction()
  const queryClient = useQueryClient()

  // Sub-sheet visibility state
  const [editBonusOpen, setEditBonusOpen] = useState(false)
  const [approveBonusOpen, setApproveBonusOpen] = useState(false)
  const [rejectReasonOpen, setRejectReasonOpen] = useState(false)
  const [addCommentOpen, setAddCommentOpen] = useState(false)
  const [blockSellerOpen, setBlockSellerOpen] = useState(false)

  // ---- Mutation: edit bonus ----
  const { mutate: doEditBonus, isPending: editBonusPending } = useMutation({
    mutationFn: ({ id, amountKopecks }: { id: string; amountKopecks: number }) =>
      editReceiptBonus(id, amountKopecks),
    onSuccess: () => {
      setEditBonusOpen(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'seller-receipts'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'seller-receipts'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'seller-receipts'] })
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'seller-receipts'] })
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

  const hasAttachments = receipt.attachments.length > 0
  const sellerName = receipt.seller_name ?? `Продавец #${receipt.seller_id}`

  function handleAction(dir: 'approve' | 'reject') {
    if (dir === 'reject') {
      setRejectReasonOpen(true)
      return
    }
    if ((receipt?.bonus_amount ?? 0) <= 0) {
      setApproveBonusOpen(true)
      return
    }
    submitReviewAction(dir)
  }

  function submitReviewAction(dir: 'approve' | 'reject', comment?: string, bonusAmountKopecks?: number) {
    swipe(
      { id: receiptId!, dir, comment, bonusAmountKopecks },
      {
        // Actualize regardless of outcome — success OR a 409 conflict from a
        // stale-state race (e.g. an approve still in-flight, then a reject): refetch
        // the deck + seller list so the UI shows the TRUE current status, then close.
        // This is the detail-sheet path, NOT an in-deck swipe (deckIdx untouched), so
        // refetching the review queue here is safe and never double-consumes a card.
        onSettled: () => {
          setApproveBonusOpen(false)
          setRejectReasonOpen(false)
          queryClient.invalidateQueries({ queryKey: ['admin', 'review-queue'] })
          queryClient.invalidateQueries({ queryKey: ['admin', 'seller-receipts'] })
          closeSheet()
        },
      },
    )
  }

  const sellerTelegramId = String(receipt.seller_id)

  return (
    <>
      {/* Sheet sc: padding 6px 16px 16px (prototype: .sc) */}
      <div className="pt-[6px] vliq-pad pb-5">
        {/* Attachments — ALL files (images / PDFs) in one reusable viewer.
            Image tap opens a fullscreen lightbox; PDF opens externally; nav is
            via tap-zones / arrows (no nested horizontal swipe). When there are
            no attachments we fall back to the skeuomorphic ReceiptGraphic. */}
        <div
          className="relative h-[330px] rounded-[18px] overflow-hidden mb-4"
          style={{ background: 'linear-gradient(160deg, #5a6172, #3d4350)' }}
        >
          <AttachmentViewer
            attachments={receipt.attachments}
            className="absolute inset-0"
            // finalCard only when there ARE attachments — a legacy receipt with
            // none keeps falling back to the skeuomorphic ReceiptGraphic mock
            // (otherwise the info-card page would suppress emptyFallback). The
            // full ReceiptInfoCard still renders below the viewer regardless.
            finalCard={
              hasAttachments ? (
                <div className="vliq-pad py-4">
                  <ReceiptInfoCard receipt={receipt} />
                </div>
              ) : undefined
            }
            emptyFallback={
              <div className="absolute inset-0 grid place-items-center">
                <div className="scale-[1.18] rotate-[-2deg]">
                  <ReceiptGraphic receipt={receipt} />
                </div>
              </div>
            }
          />
        </div>
        {!hasAttachments && (
          <div className="text-[12px] text-[var(--vliq-hint)] -mt-2 mb-3 text-center">
            Фото чека недоступно — показан макет
          </div>
        )}

        {/* Reusable info card — fiscal data, seller, duplicate/fraud signals,
            system rejection reason, OCR extraction warnings. Shared with the
            swipe-deck viewer. */}
        <ReceiptInfoCard receipt={receipt} className="mb-4" />

        <div className="grid grid-cols-2 gap-3 mx-4 mt-1 mb-4">
          {receipt.fn && receipt.fd && receipt.fp && (
            <button
              type="button"
              onClick={() => {
                const text = `${receipt.fn} / ${receipt.fd} / ${receipt.fp}`
                navigator.clipboard?.writeText(text)
                  .then(() => pushToast('Номер скопирован', 'ok'))
                  .catch(() => pushToast('Не удалось скопировать', 'dg'))
              }}
              className="min-w-0 flex items-center justify-center gap-2 rounded-[14px] px-3 py-3 text-[13px] font-extrabold leading-tight bg-[var(--vliq-field)] text-[var(--vliq-brand)] border-0 cursor-pointer active:opacity-80 transition-opacity"
            >
              <Icon name="cmt" size={17} className="flex-none" />
              <span className="min-w-0 leading-tight">Скопировать ФН / ФД / ФП</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => openSheet('seller', { telegram_id: receipt.seller_id })}
            className="min-w-0 flex items-center justify-center gap-2 rounded-[14px] px-3 py-3 text-[13px] font-extrabold leading-tight bg-[var(--vliq-field)] text-[var(--vliq-brand)] border-0 cursor-pointer active:opacity-80 transition-opacity"
          >
            <Icon name="user" size={17} className="flex-none" />
            <span className="min-w-0 leading-tight">К продавцу</span>
          </button>
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

      <EditBonusSheet
        open={approveBonusOpen}
        onClose={() => setApproveBonusOpen(false)}
        onConfirm={(amountKopecks) => {
          submitReviewAction('approve', undefined, amountKopecks)
        }}
        isSubmitting={isPending}
        title="Укажите бонус"
        confirmLabel="Подтвердить"
        submittingLabel="Подтверждение…"
        requirePositive
      />

      <RejectReasonSheet
        open={rejectReasonOpen}
        onClose={() => setRejectReasonOpen(false)}
        onConfirm={(reason) => submitReviewAction('reject', reason)}
        isSubmitting={isPending}
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
