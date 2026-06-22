import { useMemo, useState, useCallback, type ReactNode, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/atoms/Icon'
import { getTgWebApp } from '@/utils/tma'
import type { Attachment } from '@/types/models'

/** Open a URL outside the Mini App — prefers Telegram's native openLink. */
function openExternal(url: string) {
  const wa = getTgWebApp() as { openLink?: (u: string) => void } | undefined
  if (wa?.openLink) {
    wa.openLink(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Stop a pointer/click on a nav control from reaching the outer SwipeDeck
 *  drag handlers (which would otherwise read it as an approve/reject). */
function stopAll(e: PointerEvent | React.MouseEvent) {
  e.stopPropagation()
}

// ---- Fallback card (broken / null url / unsupported) ----
function FallbackCard({ label, hint }: { label: string; hint?: string }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6"
      style={{ background: 'var(--vliq-field)', color: 'var(--vliq-hint)' }}
      data-testid="attachment-fallback"
    >
      <Icon name="file" size={40} />
      <div className="text-[13.5px] font-semibold text-[var(--vliq-text)]">{label}</div>
      {hint && <div className="text-[12px]">{hint}</div>}
    </div>
  )
}

/** Small fullscreen/zoom affordance overlaid on the TOP-RIGHT of an image.
 *  Rendered even when `interactiveImage={false}` (the SwipeDeck feed) so an
 *  admin can open the receipt fullscreen straight from the review card. It
 *  stopPropagation()s on BOTH pointerdown and click so the outer SwipeDeck
 *  drag/tap never sees it — opening the lightbox can never fire an
 *  approve/reject swipe nor the detail-sheet tap. The center of the image is
 *  left untouched so a horizontal drag there still reaches the deck. */
function ZoomButton({ url, onZoom }: { url: string; onZoom: (url: string) => void }) {
  return (
    <button
      type="button"
      aria-label="Открыть фото на весь экран"
      data-testid="attachment-zoom-button"
      onPointerDown={stopAll}
      onClick={(e) => {
        stopAll(e)
        onZoom(url)
      }}
      className="absolute top-2.5 right-2.5 z-20 w-9 h-9 rounded-full grid place-items-center text-white border-0 cursor-pointer"
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <Icon name="zoom" size={17} />
    </button>
  )
}

// ---- One attachment surface ----
function AttachmentSlide({
  attachment,
  onZoom,
  interactiveImage,
}: {
  attachment: Attachment
  onZoom: (url: string) => void
  /** When false the image body is inert (the host — e.g. SwipeDeck — owns taps
   *  so its approve/reject drag is never blocked). The explicit zoom button is
   *  shown regardless so fullscreen is reachable from the feed. */
  interactiveImage: boolean
}) {
  const [broken, setBroken] = useState(false)

  if (attachment.url == null) {
    return <FallbackCard label="Файл недоступен" hint="Просмотр для этого вложения не поддерживается" />
  }

  if (attachment.kind === 'pdf') {
    const url = attachment.url
    // PDF surface is inert except the explicit button — pointerdown on the
    // button is NOT stopped so a drag starting there can still swipe the deck;
    // openExternal only fires on a genuine click (no drag).
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6"
        style={{ background: 'var(--vliq-field)' }}
        data-testid="attachment-pdf"
      >
        <Icon name="file" size={44} className="text-[var(--vliq-brand)]" />
        <div className="text-[13.5px] font-semibold text-[var(--vliq-text)]">PDF-документ</div>
        <button
          type="button"
          onClick={(e) => {
            stopAll(e)
            openExternal(url)
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[12px] text-[13px] font-bold bg-[var(--vliq-brand)] text-white border-0 cursor-pointer"
          aria-label="Открыть PDF"
        >
          <Icon name="zoom" size={15} /> Открыть PDF
        </button>
      </div>
    )
  }

  if (broken) {
    return <FallbackCard label="Не удалось загрузить изображение" hint="Файл повреждён или недоступен" />
  }

  const url = attachment.url
  const img = (
    <img
      src={url}
      alt={`Вложение ${attachment.position + 1}`}
      className="w-full h-full"
      style={{ objectFit: 'contain', background: 'linear-gradient(160deg, #cfd4dd, #b1b8c4)' }}
      draggable={false}
      onError={() => setBroken(true)}
    />
  )

  // Inert image: host owns the tap (SwipeDeck → detail sheet) and the drag
  // (approve/reject). We deliberately do NOT stopPropagation on the image body
  // so a horizontal drag across the centre still reaches the deck. The explicit
  // zoom button (which DOES stopPropagation) is the only fullscreen affordance.
  if (!interactiveImage) {
    return (
      <div className="absolute inset-0" data-testid="attachment-image">
        {img}
        <ZoomButton url={url} onZoom={onZoom} />
      </div>
    )
  }

  // Interactive image (detail sheet): tap anywhere opens the fullscreen
  // lightbox. We do NOT stopPropagation on pointerdown so an enclosing
  // scroll/drag still works; the zoom only fires on a genuine click. The
  // full-surface button keeps the `attachment-image` testid; the explicit
  // corner zoom button is layered on top as a clear affordance.
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          stopAll(e)
          onZoom(url)
        }}
        className="absolute inset-0 w-full h-full border-0 p-0 m-0 bg-transparent cursor-zoom-in"
        aria-label="Открыть изображение на весь экран"
        data-testid="attachment-image"
      >
        {img}
      </button>
      <ZoomButton url={url} onZoom={onZoom} />
    </>
  )
}

// ---- Fullscreen image overlay (portal) ----
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Изображение чека"
      onPointerDown={stopAll}
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      data-testid="attachment-lightbox"
    >
      <img
        src={url}
        alt="Чек — полноэкранный просмотр"
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
        draggable={false}
      />
      <button
        type="button"
        onClick={(e) => {
          stopAll(e)
          onClose()
        }}
        aria-label="Закрыть"
        className="absolute top-4 right-4 w-10 h-10 rounded-full grid place-items-center text-white border-0 cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.18)' }}
      >
        <Icon name="x" size={20} />
      </button>
    </div>,
    document.body,
  )
}

export interface AttachmentViewerProps {
  attachments: Attachment[]
  /** Rendered as an extra page AFTER the last attachment (the info card). */
  finalCard?: ReactNode
  /** Shown when there are no attachments at all (e.g. ReceiptGraphic mock). */
  emptyFallback?: ReactNode
  /**
   * When true (default) tapping an image opens a fullscreen lightbox. Set to
   * false inside SwipeDeck so image taps fall through to the card (which owns
   * tap→detail and drag→approve/reject); only the explicit edge nav controls
   * remain interactive there.
   */
  interactiveImage?: boolean
  className?: string
}

/**
 * Reusable viewer for a receipt's 1–5 attachments (images / PDFs) plus an
 * optional final info page.
 *
 * Navigation is via TAP ZONES (left/right halves) and explicit arrow buttons —
 * never a nested horizontal swipe. Every nav control calls `stopPropagation`
 * on pointerdown/click so it can never be read by the OUTER SwipeDeck's
 * horizontal drag (which means approve/reject). This is the critical contract:
 * tapping to advance an attachment must NOT trigger an approve/reject.
 */
export function AttachmentViewer({
  attachments,
  finalCard,
  emptyFallback,
  interactiveImage = true,
  className = '',
}: AttachmentViewerProps) {
  const ordered = useMemo(
    () => [...attachments].sort((a, b) => (a.position - b.position) || (a.id - b.id)),
    [attachments],
  )

  // Pages = attachments [+ final card]. When there are no attachments but a
  // final card exists, the final card is the only page.
  const pageCount = ordered.length + (finalCard ? 1 : 0)
  const [page, setPage] = useState(0)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  const clamp = useCallback((p: number) => Math.max(0, Math.min(p, pageCount - 1)), [pageCount])
  const goPrev = useCallback(() => setPage((p) => clamp(p - 1)), [clamp])
  const goNext = useCallback(() => setPage((p) => clamp(p + 1)), [clamp])

  // No attachments and no final card → host-supplied fallback (or nothing).
  if (pageCount === 0) {
    return (
      <div className={`relative ${className}`} data-testid="attachment-viewer">
        {emptyFallback ?? null}
      </div>
    )
  }

  const safePage = Math.min(page, pageCount - 1)
  const isFinalPage = Boolean(finalCard) && safePage === ordered.length
  const current = ordered[safePage]
  const hasPrev = safePage > 0
  const hasNext = safePage < pageCount - 1

  const counterLabel = isFinalPage ? 'Данные чека' : `${safePage + 1} / ${ordered.length}`

  return (
    <div
      className={`relative ${className}`}
      data-testid="attachment-viewer"
      aria-roledescription="Просмотр вложений чека"
    >
      {/* The page surface */}
      {isFinalPage ? (
        <div
          className="absolute inset-0 overflow-y-auto z-10"
          // `touchAction: pan-y` re-enables vertical touch scrolling here even
          // though the outer SwipeCard sets `touchAction: none` for its drag.
          // stopPropagation on pointerdown keeps a scroll/tap on the info card
          // from reaching the deck — so the final page can NEVER fire an
          // approve/reject swipe nor the detail-sheet tap.
          style={{ background: 'var(--vliq-card)', touchAction: 'pan-y' }}
          onPointerDown={stopAll}
          data-testid="attachment-final-card"
        >
          {finalCard}
        </div>
      ) : current ? (
        <AttachmentSlide
          attachment={current}
          onZoom={setZoomUrl}
          interactiveImage={interactiveImage}
        />
      ) : null}

      {/* Counter */}
      <div
        className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 px-3 py-1 rounded-full text-[11px] font-semibold pointer-events-none"
        style={{ background: 'rgba(0,0,0,0.5)', color: '#fff' }}
        data-testid="attachment-counter"
      >
        {counterLabel}
      </div>

      {/* Tap zones — only when there is somewhere to go. Sit BELOW the slide's
          interactive content (z-10) so an image tap still zooms, but cover the
          inert PDF/final-card surfaces. They stopPropagation so the outer deck
          never reads them as a swipe. */}
      {pageCount > 1 && (
        <>
          {hasPrev && (
            <button
              type="button"
              aria-label="Предыдущее вложение"
              onPointerDown={stopAll}
              onClick={(e) => {
                stopAll(e)
                goPrev()
              }}
              className="absolute left-0 top-0 bottom-0 w-[22%] z-10 border-0 bg-transparent cursor-pointer flex items-center justify-start pl-1.5"
            >
              <span
                className="w-8 h-8 rounded-full grid place-items-center text-white"
                style={{ background: 'rgba(0,0,0,0.4)' }}
              >
                <Icon name="back" size={16} />
              </span>
            </button>
          )}
          {hasNext && (
            <button
              type="button"
              aria-label="Следующее вложение"
              onPointerDown={stopAll}
              onClick={(e) => {
                stopAll(e)
                goNext()
              }}
              className="absolute right-0 top-0 bottom-0 w-[22%] z-10 border-0 bg-transparent cursor-pointer flex items-center justify-end pr-1.5"
            >
              <span
                className="w-8 h-8 rounded-full grid place-items-center text-white"
                style={{ background: 'rgba(0,0,0,0.4)', transform: 'rotate(180deg)' }}
              >
                <Icon name="back" size={16} />
              </span>
            </button>
          )}

          {/* Dot indicators */}
          <div
            className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 flex gap-1.5 pointer-events-none"
            data-testid="attachment-dots"
          >
            {Array.from({ length: pageCount }).map((_, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  background: i === safePage ? '#fff' : 'rgba(255,255,255,0.4)',
                }}
              />
            ))}
          </div>
        </>
      )}

      {zoomUrl && <Lightbox url={zoomUrl} onClose={() => setZoomUrl(null)} />}
    </div>
  )
}
