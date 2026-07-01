import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getReceiptStatus } from '@/api/receipts'
import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { Skeleton } from '@/components/atoms/Skeleton'
import { Timeline } from '@/components/molecules/Timeline'
import { EmptyState } from '@/components/molecules/EmptyState'
import type { TimelineStep } from '@/components/molecules/Timeline'
import type { Attachment, Receipt, ReceiptStatus } from '@/types/models'
import { RECEIPT_STATUS, type StatusKind } from '@/utils/receiptStatus'
import { fmtMoney } from '@/utils/formatMoney'

type IconName = Parameters<typeof Icon>[0]['name']

interface StatusVisual {
  icon: IconName
  title: string
  subtitle: string
  kind: StatusKind
}

// Per spec the seller sees one pre-decision state — «На проверке». pending /
// ocr_in_progress / on_review / (legacy) needs_revision all render the same
// review card; there is no «Нужны правки»/re-upload dead-end.
const STATUS_VISUAL: Record<ReceiptStatus, StatusVisual> = {
  pending:         { icon: 'clock',  title: 'Чек на проверке', subtitle: 'Мы проверим чек и пришлём уведомление', kind: 'wn' },
  ocr_in_progress: { icon: 'clock',  title: 'Чек на проверке', subtitle: 'Мы проверим чек и пришлём уведомление', kind: 'wn' },
  on_review:       { icon: 'clock',  title: 'Чек на проверке', subtitle: 'Мы проверим чек и пришлём уведомление', kind: 'wn' },
  needs_revision:  { icon: 'clock',  title: 'Чек на проверке', subtitle: 'Мы проверим чек и пришлём уведомление', kind: 'wn' },
  approved:        { icon: 'check',  title: 'Чек одобрен',     subtitle: 'Бонус начислен на ваш баланс',          kind: 'ok' },
  paid_out:        { icon: 'check',  title: 'Бонус выплачен',  subtitle: 'Сумма уже на ваших реквизитах',         kind: 'ok' },
  rejected:        { icon: 'x',      title: 'Чек отклонён',    subtitle: 'К сожалению, чек не прошёл проверку',    kind: 'dg' },
}

const KIND_SURFACE: Record<StatusKind, { bg: string; ink: string; pill: 'ok' | 'wn' | 'dg' | 'muted' }> = {
  ok:    { bg: 'var(--vliq-ok-bg)', ink: 'var(--vliq-ok-ink)', pill: 'ok' },
  wn:    { bg: 'var(--vliq-wn-bg)', ink: 'var(--vliq-wn-ink)', pill: 'wn' },
  dg:    { bg: 'var(--vliq-dg-bg)', ink: 'var(--vliq-dg-ink)', pill: 'dg' },
  muted: { bg: 'var(--vliq-field)', ink: 'var(--vliq-hint)',   pill: 'muted' },
}

function buildTimeline(status: ReceiptStatus, createdAt: string): TimelineStep[] {
  const fmtDate = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(createdAt))
  const isOk     = status === 'approved' || status === 'paid_out'
  const isDg     = status === 'rejected'
  const isReview = status === 'pending' || status === 'ocr_in_progress' || status === 'on_review' || status === 'needs_revision'
  const isProcessing = status === 'pending' || status === 'ocr_in_progress'

  return [
    { label: 'Чек получен',          subtitle: fmtDate, status: 'done' },
    { label: 'Данные распознаны',     subtitle: isProcessing ? 'Обрабатывается…' : undefined, status: isProcessing ? 'active' : 'done' },
    { label: 'Проверка администратором', subtitle: isReview ? 'Обычно до 24 часов' : undefined, status: isReview ? 'active' : (isOk || isDg ? 'done' : 'pending') },
    { label: 'Начисление бонуса',     subtitle: isOk ? 'Завершено' : (isDg ? 'Не начисляется' : 'Ожидается'), status: isOk ? 'done' : (isDg ? 'failed' : 'pending') },
  ]
}

/** Tile for one uploaded attachment: image inline, PDF as a link/card. */
function AttachmentTile({ att }: { att: Attachment }) {
  if (!att.url) return null
  if (att.kind === 'pdf') {
    return (
      <a
        href={att.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px',
          borderRadius: 12,
          background: 'var(--vliq-field)',
          color: 'var(--vliq-brand)',
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        <Icon name="file" size={20} aria-hidden />
        Открыть PDF →
      </a>
    )
  }
  return (
    <a href={att.url} target="_blank" rel="noopener noreferrer" aria-label="Открыть фото на весь экран" style={{ display: 'block' }}>
      <img
        src={att.url}
        alt="Фото чека"
        style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 12, background: 'var(--vliq-field)' }}
      />
    </a>
  )
}

/**
 * Render the receipt's uploaded files. Prefers the ordered `attachments`
 * package; falls back to the legacy single `file_url` only when the package is
 * empty/absent (older receipts).
 */
function ReceiptAttachments({ receipt }: { receipt: Receipt }) {
  const attachments = receipt.attachments ?? []
  const hasAttachments = attachments.length > 0
  const legacyUrl = receipt.file_url

  if (!hasAttachments && !legacyUrl) return null

  return (
    <div className="vliq-card" style={{ padding: 14, marginTop: 14 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: 'var(--vliq-text)' }}>
        Загруженный чек
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {hasAttachments ? (
          [...attachments]
            .sort((a, b) => a.position - b.position)
            .map((att) => <AttachmentTile key={att.id} att={att} />)
        ) : legacyUrl ? (
          legacyUrl.toLowerCase().endsWith('.pdf') ? (
            <a href={legacyUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', textAlign: 'center', padding: '14px', borderRadius: 12, background: 'var(--vliq-field)', color: 'var(--vliq-brand)', fontWeight: 600, fontSize: 14 }}>
              Открыть PDF →
            </a>
          ) : (
            <a href={legacyUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть фото на весь экран" style={{ display: 'block' }}>
              <img
                src={legacyUrl}
                alt="Фото чека"
                style={{ display: 'block', width: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 12, background: 'var(--vliq-field)' }}
              />
            </a>
          )
        ) : null}
      </div>
    </div>
  )
}

export function StatusPage() {
  const { id } = useParams<{ id: string }>()

  // `/receipts/:id` is admin-only; sellers use the lightweight status-poll
  // endpoint which only returns status + bonus_amount + updated_at.
  const { data: receipt, isLoading, isError, refetch } = useQuery({
    queryKey: ['receipt-status', id],
    queryFn: () => {
      if (!id) throw new Error('No ID')
      return getReceiptStatus(id)
    },
    enabled: Boolean(id),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      // Poll while the receipt is still in the review pipeline (pending →
      // ocr_in_progress → on_review) so the seller sees the admin's decision
      // (approved/rejected) land without a manual refresh.
      if (status && status !== 'approved' && status !== 'paid_out' && status !== 'rejected') {
        return 4000
      }
      return false
    },
  })

  if (isLoading) {
    return (
      <div className="vliq-pad" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Status card skeleton */}
        <div className="vliq-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Skeleton className="w-[70px] h-[70px] rounded-[22px]" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        {/* Timeline card skeleton */}
        <div className="vliq-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Skeleton className="h-4 w-32 mb-2" />
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      </div>
    )
  }
  if (isError || !receipt) {
    return (
      <div className="vliq-pad" style={{ paddingTop: 16 }}>
        <EmptyState
          icon="alert"
          tone="dg"
          title="Не удалось загрузить чек"
          description="Попробуйте обновить — возможно, проблемы с сетью."
          action={
            <button
              type="button"
              onClick={() => void refetch()}
              style={{
                background: 'var(--vliq-brand)',
                color: '#fff',
                border: 0,
                fontWeight: 700,
                padding: '11px 18px',
                borderRadius: 12,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Обновить
            </button>
          }
        />
      </div>
    )
  }

  const visual = STATUS_VISUAL[receipt.status]
  const surface = KIND_SURFACE[visual.kind]
  const cfg = RECEIPT_STATUS[receipt.status]
  const steps = buildTimeline(receipt.status, receipt.created_at)

  return (
    <div className="vliq-pad" style={{ paddingTop: 16 }}>
      {/* Status card */}
      <div className="vliq-card" style={{ padding: 20, textAlign: 'center', marginBottom: 16 }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 22,
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 14px',
            background: surface.bg,
            color: surface.ink,
          }}
        >
          <Icon name={visual.icon} size={30} />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-.2px', color: 'var(--vliq-text)' }}>
          {visual.title}
        </h2>
        <p style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--vliq-hint)', marginTop: 6 }}>
          {visual.subtitle}
        </p>
        <Pill kind={surface.pill} className="mt-[14px]">{cfg.label}</Pill>
        {receipt.rejection_reason && receipt.status === 'rejected' && (
          <div
            style={{
              marginTop: 14,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--vliq-dg-bg)',
              color: 'var(--vliq-dg-ink)',
              fontSize: 13,
              fontWeight: 500,
              textAlign: 'left',
              lineHeight: 1.4,
            }}
          >
            {receipt.rejection_reason}
          </div>
        )}
      </div>

      {/* Timeline card */}
      <div className="vliq-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, color: 'var(--vliq-text)' }}>
          Статус обработки
        </h3>
        <Timeline steps={steps} />
      </div>

      {/* Uploaded receipt package (S4): render ALL attachments by position.
          Fall back to the legacy single file_url only when none are present. */}
      <ReceiptAttachments receipt={receipt} />

      {/* Bonus preview */}
      {receipt.bonus_amount !== undefined
        && receipt.bonus_amount > 0
        && (receipt.status === 'approved' || receipt.status === 'paid_out') && (
        <div className="vliq-card" style={{ padding: 16, marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--vliq-hint)' }}>
              Начислено
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--vliq-text)', fontVariantNumeric: 'tabular-nums' }}>
              +{fmtMoney(receipt.bonus_amount)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
