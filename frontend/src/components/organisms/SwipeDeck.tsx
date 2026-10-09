import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion'
import type { TargetAndTransition } from 'framer-motion'
import { Icon } from '@/components/atoms/Icon'
import type { AdminReceipt } from '@/api/admin'
import { ReviewCardSummary } from '@/components/organisms/ReviewCardSummary'
import { ReviewHelp } from '@/components/organisms/ReviewHelp'
import type { SwipeDirection } from '@/features/admin/hooks/useReviewQueue'
import { plural } from '@/utils/formatMoney'

// Swipe thresholds (from prototype)
const THRESHOLD_X = 95
const THRESHOLD_Y = 90

const FLY: Record<SwipeDirection, TargetAndTransition> = {
  approve: { x: 520, y: -40, rotate: 24, opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
  reject:  { x: -520, y: -40, rotate: -24, opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
  revise:  { x: 0, y: -880, rotate: 0, opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 1, 1] } },
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
  onSellerClick?: (sellerId: number) => void
  /** Swipe down: move the card to the end of the deck without a decision. */
  onSkip?: () => void
}

function SwipeCard({ receipt, stackIndex, onSwipe, onTap, isTop, canSwipe, onSellerClick, onSkip }: SwipeCardProps) {
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

    // Swipe DOWN = skip: no decision, the card goes to the end of this session's deck.
    const dy = e.clientY - dragRef.current.startY
    if (onSkip && dy > THRESHOLD_Y && dy > Math.abs(dx)) {
      x.set(0); y.set(0)
      onSkip()
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

      {/* The decision card: key facts only — the photo and everything else open
          via «Подробнее» / tap (ReceiptDetailSheet). Big photos made the card and
          the action buttons overflow small screens (e.g. Galaxy Z Flip). */}
      <ReviewCardSummary receipt={receipt} onDetails={onTap} onSellerClick={onSellerClick} />
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
  /** Server-side total of the review queue (all on_review). Denominator for
   *  the "N / total" counter; falls back to the loaded count when omitted. */
  totalCount?: number
  /** Open the seller page (stats + previous receipts) from the final info card. */
  onSellerClick?: (sellerId: number) => void
  /** A card was skipped (moved to the end of the deck, no API call). */
  onSkip?: (receiptId: string) => void
  /** An approve / reject is being sent: every action is locked until it settles. */
  isActing?: boolean
}

export function SwipeDeck({ receipts, onSwipe, onTap, isLoading, undoTrigger = 0, totalCount, onSellerClick, onSkip, isActing = false }: SwipeDeckProps) {
  // Consume the queue by receipt ID, not by positional index. A positional
  // index silently SKIPS cards whenever the list shrinks from the front — which
  // happens on any mid-session refetch (window focus, a detail-sheet action, a
  // 409). With an id set, already-actioned cards are filtered out regardless of
  // list order, so refetches are safe and nothing is skipped. orderRef is the
  // undo stack (most-recently-actioned id on top).
  const [processedIds, setProcessedIds] = useState<Set<string>>(() => new Set())
  const orderRef = useRef<Array<{ id: string; dir: SwipeDirection }>>([])
  const [processed, setProcessed] = useState({ approve: 0, reject: 0, revise: 0 })

  // Skipped ids in skip order. A skipped card is NOT processed: it stays in the
  // queue (server untouched) and simply moves behind every not-yet-skipped card,
  // so the admin can come back to it later in the session.
  const [skippedIds, setSkippedIds] = useState<string[]>([])

  const pending = useMemo(() => {
    const open = receipts.filter((r) => !processedIds.has(r.id))
    if (skippedIds.length === 0) return open
    const skipped = new Set(skippedIds)
    const byId = new Map(open.map((r) => [r.id, r]))
    const tail = skippedIds.map((id) => byId.get(id)).filter((r): r is AdminReceipt => r != null)
    return [...open.filter((r) => !skipped.has(r.id)), ...tail]
  }, [receipts, processedIds, skippedIds])

  // Watch external undoTrigger; on increment, un-process the most recently
  // actioned card so it returns to the top of the deck. No positional clamp is
  // needed any more — id-based consumption is inherently refetch-safe.
  // Controlled-component pattern: parent owns the undo signal, child reacts.
  const lastUndoRef = useRef(undoTrigger)
  useEffect(() => {
    if (undoTrigger !== lastUndoRef.current) {
      lastUndoRef.current = undoTrigger
      const last = orderRef.current.pop()
      if (last !== undefined) {
        setProcessedIds((prev) => {
          const next = new Set(prev)
          next.delete(last.id)
          return next
        })
        // Roll back the summary stat too, else a cancelled reject/approve sheet
        // or a 409 rollback over-counts in the DoneState summary.
        setProcessed((prev) => ({ ...prev, [last.dir]: Math.max(0, prev[last.dir] - 1) }))
      }
    }
  }, [undoTrigger])

  const handleSwipe = useCallback(
    (dir: SwipeDirection) => {
      const current = pending[0]
      if (!current || isActing) return
      setProcessed((prev) => ({ ...prev, [dir]: prev[dir] + 1 }))
      onSwipe(current.id, dir)
      orderRef.current.push({ id: current.id, dir })
      setProcessedIds((prev) => new Set(prev).add(current.id))
    },
    [pending, onSwipe, isActing],
  )

  const handleSkip = useCallback(() => {
    const current = pending[0]
    if (!current || isActing) return
    setSkippedIds((prev) => [...prev.filter((id) => id !== current.id), current.id])
    onSkip?.(current.id)
  }, [pending, onSkip, isActing])

  const remaining = pending.length
  const skippedCount = pending.filter((r) => skippedIds.includes(r.id)).length
  // Show the real backlog size (server total of on_review), not just how many
  // pages happen to be loaded — otherwise the counter is stuck at e.g. 20/20.
  const totalForCounter = totalCount ?? receipts.length
  const isDone = !isLoading && remaining <= 0
  const visibleCount = Math.min(3, remaining)
  const visibleReceipts = pending.slice(0, visibleCount)
  const currentReceipt = pending[0]

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

  // Everything left was skipped: the main queue is done — say so, and make the way
  // back to the skipped receipts explicit instead of silently cycling them.
  if (!isLoading && remaining > 0 && skippedCount === remaining) {
    return (
      <div className="vliq-pad" data-testid="skipped-gate"
        style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div style={{ display: 'grid', gap: 12, maxWidth: 320 }}>
          <b style={{ fontSize: 19 }}>Основная очередь разобрана</b>
          <span style={{ color: 'var(--vliq-hint)', fontSize: 14 }}>
            Пропущено {skippedCount} {plural(skippedCount, ['чек', 'чека', 'чеков'])} — они всё ещё на проверке.
          </span>
          <button type="button" className="vliq-btn" onClick={() => setSkippedIds([])}
            style={{ padding: '13px 16px', borderRadius: 14, border: 0, fontWeight: 700, fontSize: 15,
              background: 'var(--vliq-brand)', color: '#fff', cursor: 'pointer' }}>
            К пропущенным
          </button>
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
        onReset={() => { orderRef.current = []; setProcessedIds(new Set()); setSkippedIds([]); setProcessed({ approve: 0, reject: 0, revise: 0 }) }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.15, color: 'var(--vliq-text)' }}>
              Проверка чеков
            </h1>
            <ReviewHelp />
          </div>
          {(currentReceipt?.status !== 'on_review' || skippedCount > 0) && (
            <p style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--vliq-hint)', marginTop: 2 }}>
              {[
                currentReceipt?.status !== 'on_review' && 'Чек ещё обрабатывается — можно пропустить',
                skippedCount > 0 && `пропущено ${skippedCount}`,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <span style={{ flex: 'none', fontSize: 13, fontWeight: 700, color: 'var(--vliq-hint)', marginTop: 4 }}>
          <span data-testid="deck-counter">
            {isLoading ? '…' : `${Math.min(processedIds.size + 1, totalForCounter)} / ${totalForCounter}`}
          </span>
        </span>
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
            const canSwipe = isTop && receipt.status === 'on_review' && !isActing
            return (
              <SwipeCard
                key={receipt.id}
                receipt={receipt}
                stackIndex={stackIndex}
                isTop={isTop}
                canSwipe={canSwipe}
                onSwipe={handleSwipe}
                onTap={() => { if (isTop && currentReceipt) onTap(currentReceipt.id) }}
                onSellerClick={onSellerClick}
                onSkip={isActing ? undefined : handleSkip}
              />
            )
          })}
        </AnimatePresence>
      </div>

      {/* KAN-37 / A2: keep the mobile swipe flow, but expose equivalent native
          actions on tablet/desktop where a drag gesture is not discoverable. */}
      <div className="vliq-review-native-actions" data-swipe-deck-control="true">
        <button
          type="button"
          className="vliq-review-native-action vliq-review-native-action--reject"
          disabled={isActing || currentReceipt?.status !== 'on_review'}
          onClick={() => handleSwipe('reject')}
        >
          <Icon name="x" size={18} />
          <span className="vliq-review-native-action__label">Отклонить</span>
        </button>
        <button
          type="button"
          className="vliq-review-native-action vliq-review-native-action--skip"
          disabled={isActing || remaining < 1}
          onClick={handleSkip}
          aria-label="Пропустить чек"
        >
          <Icon name="chev" size={18} />
          <span className="vliq-review-native-action__label">Пропустить</span>
        </button>
        <button
          type="button"
          className="vliq-review-native-action vliq-review-native-action--approve"
          disabled={isActing || currentReceipt?.status !== 'on_review'}
          onClick={() => handleSwipe('approve')}
        >
          <Icon name="check" size={18} />
          <span className="vliq-review-native-action__label">Одобрить</span>
        </button>
      </div>
    </div>
  )
}
