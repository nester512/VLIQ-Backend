import { useState, useCallback, useRef, useEffect } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'
import type { TargetAndTransition } from 'framer-motion'
import { Icon } from '@/components/atoms/Icon'
import { Avatar } from '@/components/atoms/Avatar'
import { Pill } from '@/components/atoms/Pill'
import { ReceiptGraphic } from '@/components/molecules/ReceiptGraphic'
import { ReceiptInfoCard } from '@/components/molecules/ReceiptInfoCard'
import { AttachmentViewer } from '@/components/organisms/AttachmentViewer'
import { fmtMoney, fmtMoneyDelta } from '@/utils/formatMoney'
import type { AdminReceipt } from '@/api/admin'
import type { SwipeDirection } from '@/features/admin/hooks/useReviewQueue'

// Swipe thresholds (from prototype)
const THRESHOLD_X = 95
const THRESHOLD_Y = 90

const FLY: Record<SwipeDirection, TargetAndTransition> = {
  approve: { x: 520, y: -40, rotate: 24, opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
  reject:  { x: -520, y: -40, rotate: -24, opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
  revise:  { x: 0, y: -880, rotate: 0, opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
}

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}

function isSwipeDeckControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-swipe-deck-control="true"]') != null
}

// ---- SwipeCard ----
interface SwipeCardProps {
  receipt: AdminReceipt
  stackIndex: number  // 0 = top card
  onSwipe: (dir: SwipeDirection) => void
  onTap: () => void
  isTop: boolean
  canSwipe: boolean
}

function SwipeCard({ receipt, stackIndex, onSwipe, onTap, isTop, canSwipe }: SwipeCardProps) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)

  const okOpacity = useTransform(x, [0, THRESHOLD_X, THRESHOLD_X * 2], [0, 0.6, 1])
  const dgOpacity = useTransform(x, [-THRESHOLD_X * 2, -THRESHOLD_X, 0], [1, 0.6, 0])
  // upOpacity (ДОРАБОТКА stamp) — DISABLED with the revise gesture (see onPtrUp).
  // const upOpacity = useTransform(y, [-THRESHOLD_Y * 2, -THRESHOLD_Y, 0], [1, 0.6, 0])
  const okTint    = useTransform(x, [0, THRESHOLD_X * 2], [0, 0.22])
  const dgTint    = useTransform(x, [-THRESHOLD_X * 2, 0], [0.22, 0])
  const upTint    = useTransform(y, [-THRESHOLD_Y * 2, 0], [0.22, 0])
  const rotate    = useTransform(x, [-200, 0, 200], [-18, 0, 18])

  const scale     = 1 - stackIndex * 0.045
  const offsetY   = stackIndex * 14

  const [flyDir, setFlyDir] = useState<SwipeDirection | null>(null)

  // Drag origin held in a ref so the value survives re-renders triggered by
  // setFlyDir / parent updates mid-drag. The previous `let startX = 0`
  // inside the component body was reset on every render, which meant the
  // card "ran away" from the cursor on slow networks.
  const dragRef = useRef({ startX: 0, startY: 0, moved: false, active: false })

  function onPtrDown(e: React.PointerEvent) {
    if (!isTop || !canSwipe || flyDir) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false, active: true }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch {/* */}
  }

  function onPtrMove(e: React.PointerEvent) {
    if (!isTop || !canSwipe || flyDir || !dragRef.current.active) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) + Math.abs(dy) > 6) dragRef.current.moved = true
    // Up-swipe «Доработка» (revise) DISABLED — clamp y so the card never lifts
    // up and the revise tint/stamp stay inert. To restore: `const isUpSwipe =
    // dy < 0 && Math.abs(dy) > Math.abs(dx)`, `x.set(isUpSwipe ? 0 : dx)`, `y.set(dy)`.
    x.set(dx)
    y.set(Math.max(0, dy))
  }

  function onPtrUp(e: React.PointerEvent) {
    if (!isTop) return
    if (!canSwipe) {
      if (!isSwipeDeckControl(e.target)) onTap()
      return
    }
    if (!dragRef.current.active) return
    const dx = e.clientX - dragRef.current.startX
    const wasMoved = dragRef.current.moved
    dragRef.current.active = false

    if (!wasMoved) {
      if (!isSwipeDeckControl(e.target)) onTap()
      return
    }

    // Up-swipe «Доработка» (revise) DISABLED per spec — revise is out of scope
    // (a bad receipt is simply rejected). Kept commented so it can be restored:
    // uncomment + restore `y.set(dy)` in onPtrMove, the upOpacity def, the
    // ДОРАБОТКА stamp and the legend hint below.
    //   const dy = e.clientY - dragRef.current.startY
    //   const isUp = dy < -THRESHOLD_Y && Math.abs(dy) > Math.abs(dx)
    //   if (isUp) { doFly('revise'); return }
    if (dx > THRESHOLD_X) {
      doFly('approve')
    } else if (dx < -THRESHOLD_X) {
      doFly('reject')
    } else {
      x.set(0); y.set(0)
    }
  }

  function onPtrCancel() {
    // Pointer was cancelled (scroll-jacked, window blurred, etc.) — snap back.
    if (!dragRef.current.active) return
    dragRef.current.active = false
    x.set(0); y.set(0)
  }

  function doFly(dir: SwipeDirection) {
    setFlyDir(dir)
    setTimeout(() => onSwipe(dir), 320)
  }

  const sellerName = receipt.seller_name ?? `Продавец #${receipt.seller_id}`
  const sellerStore = receipt.seller_store ?? '—'
  const dupStatus = receipt.duplicate_status ?? 'ok'
  const dupLabel = receipt.duplicate_label ?? 'Дублей нет'
  const hasAttachments = receipt.attachments.length > 0

  return (
    <motion.div
      key={receipt.id}
      animate={flyDir ? FLY[flyDir] : undefined}
      /* Inline so Tailwind v4's JIT can't accidentally drop arbitrary classes —
         the card MUST fill the deck container height (inset:0, not inset-x). */
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 24,
        overflow: 'hidden',
        background: 'var(--vliq-card)',
        boxShadow: 'var(--vliq-shadow)',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        x: isTop ? x : 0,
        y: isTop ? y : 0,
        rotate: isTop ? rotate : 0,
        scale,
        translateY: offsetY,
        zIndex: 10 - stackIndex,
        touchAction: 'none',
        cursor: isTop ? (canSwipe ? 'grab' : 'pointer') : 'default',
      }}
      onPointerDown={isTop ? onPtrDown : undefined}
      onPointerMove={isTop ? onPtrMove : undefined}
      onPointerUp={isTop ? onPtrUp : undefined}
      onPointerCancel={isTop ? onPtrCancel : undefined}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
    >
      {/* Colour tints */}
      <motion.div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none', borderRadius: 22, background: '#16B981', opacity: isTop ? okTint : 0 }} />
      <motion.div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none', borderRadius: 22, background: '#F0455A', opacity: isTop ? dgTint : 0 }} />
      <motion.div style={{ position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none', borderRadius: 22, background: '#F39A12', opacity: isTop ? upTint : 0 }} />

      {/* Decision stamps — prototype: font-size 30px, padding 8px 18px, border 4px, border-radius 14px, top 26px
          Uses .vliq-swipe-stamp so the stable CSS class (not Tailwind arbitrary values) controls geometry. */}
      {isTop && canSwipe && (
        <>
          <motion.div
            className="vliq-swipe-stamp vliq-swipe-stamp--ok"
            style={{ opacity: okOpacity, rotate: -16, top: 26, left: 22 }}
          >
            ОДОБРЕНО
          </motion.div>
          <motion.div
            className="vliq-swipe-stamp vliq-swipe-stamp--dg"
            style={{ opacity: dgOpacity, rotate: 16, top: 26, right: 22 }}
          >
            ОТКЛОНЁН
          </motion.div>
          {/* «ДОРАБОТКА» revise stamp — DISABLED (revise out of scope). Restore
              with the swipe-up gesture (onPtrUp), the upOpacity def and the legend hint:
          <motion.div
            className="vliq-swipe-stamp vliq-swipe-stamp--wn"
            style={{ opacity: upOpacity, left: '50%', translateX: '-50%', bottom: 120 }}
          >
            ДОРАБОТКА
          </motion.div>
          */}
        </>
      )}

      {/* Receipt image / placeholder — prototype: .photo{flex:1} fills remaining space */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          minHeight: 0,
          background: 'linear-gradient(160deg, #cfd4dd, #b1b8c4)',
        }}
      >
        {/* AttachmentViewer renders ALL of the receipt's attachments (images /
            PDFs) followed by the receipt+seller info card as the LAST page
            (finalCard). Its inner nav uses TAP ZONES + arrow buttons that
            stopPropagation, so advancing a page never reaches this card's
            pointer handlers (= never fires an approve/reject swipe). The image's
            explicit zoom button opens the fullscreen lightbox (also
            stopPropagation'd) without breaking the deck drag. When the receipt
            has no attachments we fall back to the skeuomorphic ReceiptGraphic
            mock as the page BEFORE the info card. */}
        <AttachmentViewer
          attachments={receipt.attachments}
          interactiveImage={false}
          className="absolute inset-0"
          finalCard={
            hasAttachments ? (
              <div className="vliq-pad py-4">
                <ReceiptInfoCard receipt={receipt} />
              </div>
            ) : undefined
          }
          emptyFallback={
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ transform: 'scale(.95) rotate(-2deg)', pointerEvents: 'none' }}>
                <ReceiptGraphic receipt={receipt} />
              </div>
            </div>
          }
        />
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.45)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            padding: '6px 12px',
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}
        >
          <Icon name="zoom" size={12} />
          Тап — фото и данные
        </div>
      </div>

      {/* Meta — extra right padding keeps the duplicate badge away from the
          rounded card corner and from the attachment nav overlay. */}
      <div style={{ padding: '14px 24px 16px 16px', flex: 'none', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar initials={getInitials(sellerName)} size={38} className="rounded-[12px]" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{
              display: 'block', fontSize: 15, fontWeight: 700, color: 'var(--vliq-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {sellerName}
            </b>
            <span style={{
              display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--vliq-hint)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {sellerStore}
            </span>
          </div>
          {/* Do not truncate "Возможный дубль": the admin needs the full signal. */}
          <span style={{ flex: 'none', minWidth: 0, display: 'block' }}>
            <Pill kind={dupStatus === 'ok' ? 'ok' : 'dg'}>
              <Icon name={dupStatus === 'ok' ? 'shield' : 'alert'} size={11} />
              <span style={{ whiteSpace: 'nowrap' }}>{dupLabel}</span>
            </Pill>
          </span>
        </div>

        {/* Stats — prototype: .swstats{display:flex;gap:8px;margin-top:12px} */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {[
            { k: 'Бонус',  v: receipt.bonus_amount != null && receipt.bonus_amount > 0 ? fmtMoneyDelta(receipt.bonus_amount) : '—', color: 'var(--vliq-ok-ink)' },
            { k: 'Сумма',  v: fmtMoney(receipt.amount), color: 'var(--vliq-text)' },
          ].map(({ k, v, color }) => (
            <div
              key={k}
              style={{
                flex: '1 1 0',
                minWidth: 0,
                background: 'var(--vliq-field)',
                borderRadius: 13,
                padding: '9px 11px',
              }}
            >
              <div style={{
                fontSize: 10.5, fontWeight: 700,
                color: 'var(--vliq-hint)',
                textTransform: 'uppercase',
                letterSpacing: '.4px',
              }}>
                {k}
              </div>
              <div
                style={{
                  fontSize: 'clamp(13px, 4vw, 16px)',
                  fontWeight: 800,
                  marginTop: 3,
                  color,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={v}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ---- Done state ----
interface DoneStateProps {
  processed: { approve: number; reject: number; revise: number }
  onReset: () => void
  /** When true, no receipts ever loaded — show a friendlier "queue is empty" message. */
  isInitiallyEmpty: boolean
}

function DoneState({ processed, onReset, isInitiallyEmpty }: DoneStateProps) {
  const title = isInitiallyEmpty ? 'Очередь пуста' : 'Все чеки обработаны'
  const subtitle = isInitiallyEmpty
    ? 'Когда продавцы загрузят новые чеки — они появятся здесь.'
    : `Одобрено ${processed.approve} · Отклонено ${processed.reject} · На доработку ${processed.revise}`
  const icon: Parameters<typeof Icon>[0]['name'] = isInitiallyEmpty ? 'receipt' : 'check'

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        gap: 12,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: isInitiallyEmpty ? 'var(--vliq-field)' : 'var(--vliq-ok-bg)',
          color: isInitiallyEmpty ? 'var(--vliq-hint)' : 'var(--vliq-ok-ink)',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Icon name={icon} size={32} />
      </div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--vliq-text)' }}>{title}</h2>
      <p style={{ fontSize: 13.5, color: 'var(--vliq-hint)', lineHeight: 1.5, maxWidth: 280 }}>
        {subtitle}
      </p>
      {!isInitiallyEmpty && (
        <button
          type="button"
          onClick={onReset}
          style={{
            marginTop: 8,
            background: 'var(--vliq-field)',
            color: 'var(--vliq-text)',
            fontWeight: 700,
            padding: '12px 20px',
            borderRadius: 14,
            border: 0,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Начать заново
        </button>
      )}
    </div>
  )
}

// ---- SwipeDeck ----
export interface SwipeDeckProps {
  receipts: AdminReceipt[]
  onSwipe: (id: string, dir: SwipeDirection) => void
  onTap: (receiptId: string) => void
  isLoading?: boolean
  /** Increment to undo the most recent swipe (used when admin cancels the
   *  reject/revise modal — the card should reappear at top of deck). */
  undoTrigger?: number
}

export function SwipeDeck({ receipts, onSwipe, onTap, isLoading, undoTrigger = 0 }: SwipeDeckProps) {
  const [deckIdx, setDeckIdx] = useState(0)
  const [processed, setProcessed] = useState({ approve: 0, reject: 0, revise: 0 })

  // Watch external undoTrigger; on increment, step deckIdx back by one so the
  // card the user just swiped away comes back into view.
  // Also clamp deckIdx if the underlying list shrank (after refetch).
  // Controlled-component pattern: parent owns the undo signal, child reacts.
  const lastUndoRef = useRef(undoTrigger)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (undoTrigger !== lastUndoRef.current) {
      lastUndoRef.current = undoTrigger
      setDeckIdx((i) => Math.max(0, i - 1))
    }
    setDeckIdx((i) => Math.min(i, receipts.length))
  }, [undoTrigger, receipts.length])
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSwipe = useCallback(
    (dir: SwipeDirection) => {
      const current = receipts[deckIdx]
      if (!current) return
      setProcessed((prev) => ({ ...prev, [dir]: prev[dir] + 1 }))
      onSwipe(current.id, dir)
      setDeckIdx((i) => i + 1)
    },
    [receipts, deckIdx, onSwipe],
  )

  const remaining = receipts.length - deckIdx
  const isDone = !isLoading && remaining <= 0
  const visibleCount = Math.min(3, remaining)
  const visibleReceipts = receipts.slice(deckIdx, deckIdx + visibleCount)
  const currentReceipt = receipts[deckIdx]

  if (isLoading && receipts.length === 0) {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 8,
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px 6px', flex: 'none',
          }}
        >
          <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.15 }}>
            Проверка чеков
          </h1>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--vliq-hint)' }}>загрузка…</span>
        </div>
        <div style={{ position: 'relative', flex: 1, margin: '6px 18px 0', minHeight: 0 }}>
          <div
            className="animate-pulse"
            style={{
              position: 'absolute', inset: 0,
              borderRadius: 24,
              background: 'var(--vliq-card)',
              boxShadow: 'var(--vliq-shadow)',
            }}
            aria-label="Загрузка чеков"
          />
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 18, padding: '16px 0 18px', opacity: 0.4, flex: 'none',
          }}
        >
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--vliq-field)' }} />
          <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'var(--vliq-field)' }} />
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--vliq-field)' }} />
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--vliq-field)' }} />
        </div>
      </div>
    )
  }

  if (isDone) {
    const isInitiallyEmpty = receipts.length === 0
    return (
      <DoneState
        processed={processed}
        isInitiallyEmpty={isInitiallyEmpty}
        onReset={() => { setDeckIdx(0); setProcessed({ approve: 0, reject: 0, revise: 0 }) }}
      />
    )
  }

  return (
    // Prototype: .deckwrap{position:absolute;inset:0;display:flex;flex-direction:column;padding-top:8px}
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        paddingTop: 8,
        minHeight: 0,
      }}
    >
      {/* Deck head — title + subtitle on the left, counter on the right. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '14px 18px 6px',
          gap: 12,
          flex: 'none',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.15, color: 'var(--vliq-text)' }}>
            Проверка чеков
          </h1>
          <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--vliq-hint)', marginTop: 2 }}>
            {currentReceipt?.status === 'on_review'
              ? 'Свайпните карточку или нажмите для деталей'
              : 'Чек ещё обрабатывается · нажмите для деталей'}
          </p>
        </div>
        <span style={{ flex: 'none', fontSize: 13, fontWeight: 700, color: 'var(--vliq-hint)', marginTop: 4 }}>
          {isLoading ? '…' : `${Math.min(deckIdx + 1, receipts.length)} / ${receipts.length}`}
        </span>
      </div>

      {/* Legend — three direction hints (lg pills) + one 'tap' hint */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 7,
          padding: '4px 16px 10px',
          flex: 'none',
        }}
      >
        {[
          { label: '→ Одобрить',  bg: 'var(--vliq-ok-bg)', ink: 'var(--vliq-ok-ink)' },
          { label: '← Отклонить', bg: 'var(--vliq-dg-bg)', ink: 'var(--vliq-dg-ink)' },
          // «↑ На доработку» (revise) hint — DISABLED; restore with the gesture (onPtrUp):
          // { label: '↑ На доработку', bg: 'var(--vliq-wn-bg)', ink: 'var(--vliq-wn-ink)' },
          { label: 'Тап — фото и данные', bg: 'var(--vliq-field)', ink: 'var(--vliq-hint)' },
        ].map(({ label, bg, ink }) => (
          <span
            key={label}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 11.5,
              fontWeight: 700,
              padding: '6px 11px',
              borderRadius: 10,
              background: bg,
              color: ink,
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Deck — prototype: .deck{position:relative;flex:1;margin:6px 18px 0} */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          margin: '6px 18px 0',
          minHeight: 0,
        }}
      >
        <AnimatePresence>
          {[...visibleReceipts].reverse().map((receipt, rIdx) => {
            const stackIndex = visibleCount - 1 - rIdx
            const isTop = stackIndex === 0
            const canSwipe = isTop && receipt.status === 'on_review'
            return (
              <SwipeCard
                key={receipt.id}
                receipt={receipt}
                stackIndex={stackIndex}
                isTop={isTop}
                canSwipe={canSwipe}
                onSwipe={handleSwipe}
                onTap={() => { if (isTop && currentReceipt) onTap(currentReceipt.id) }}
              />
            )
          })}
        </AnimatePresence>
      </div>

      {/* Bottom spacer — was the action button row; removed in favour of
          swipe-gesture-only UX so the card claims the extra vertical space. */}
      <div style={{ height: 12, flex: 'none' }} />
    </div>
  )
}
