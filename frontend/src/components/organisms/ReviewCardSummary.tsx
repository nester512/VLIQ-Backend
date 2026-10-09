import { Avatar } from '@/components/atoms/Avatar'
import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { fmtMoney, fmtMoneyDelta, plural } from '@/utils/formatMoney'
import { formatDate, formatDateTime } from '@/utils/formatDate'
import { SOURCE_LABEL, VERIFICATION_KIND, verificationLabel } from '@/features/admin/verificationLabels'
import type { AdminReceipt } from '@/api/admin'
import { ReceiptItems } from '@/components/molecules/ReceiptItems'
import { receiptCheckUrl } from '@/utils/receiptCheckUrl'

/** Short chip labels for the signals an admin must notice before deciding. */
const SIGNAL_SHORT: Record<string, string> = {
  historical_duplicate_fn_fd_fp: 'Повтор чека',
  historical_duplicate_file_hash: 'Повтор фото',
  fn_fd_fp_duplicate: 'Повтор чека',
  file_hash_duplicate: 'Повтор фото',
  qr_raw_duplicate: 'Повтор QR',
  cross_seller_duplicate: 'Чек другого продавца',
  receipt_too_old: 'Старше 30 дней',
  qr_ofd_sum_mismatch: 'Сумма ≠ ОФД',
  multiple_receipts_detected: 'Несколько чеков',
  pipeline_enqueue_failed: 'Сбой обработки',
  no_sku_match: 'Товары не распознаны',
}
const HIDDEN_SIGNALS = new Set(['demo_mode'])
const MAX_CHIPS = 3

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map((p) => p[0] ?? '').join('').toUpperCase()

/** Uniform hit area for controls inside a swipeable card: the gesture must not start on them. */
const control = {
  'data-swipe-deck-control': 'true',
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
} as const

interface ReviewCardSummaryProps {
  receipt: AdminReceipt
  onDetails: () => void
  onSellerClick?: (sellerId: number) => void
}

/**
 * The receipt as the admin needs it to decide — no photo. Everything else
 * (attachments, items, raw fiscal data, OFD history) opens via «Подробнее».
 */
export function ReviewCardSummary({ receipt, onDetails, onSellerClick }: ReviewCardSummaryProps) {
  const sellerName = receipt.seller_name ?? `Продавец #${receipt.seller_id}`
  const signals = (receipt.fraud_signal ?? []).filter((s) => !HIDDEN_SIGNALS.has(s.type))
  const chips = [...new Set(signals.map((s) => SIGNAL_SHORT[s.type] ?? 'Сигнал риска'))]
  const files = receipt.attachments.length
  const checkUrl = receiptCheckUrl(receipt)
  const items = receipt.items?.length ?? 0
  const verification = receipt.verification_status && receipt.verification_status !== 'not_required'
    ? receipt.verification_status
    : null

  const rows: Array<[string, string]> = [
    ['Дата покупки', receipt.purchase_date ? formatDate(receipt.purchase_date) : '—'],
    ['Загружен', formatDateTime(receipt.created_at)],
    ['Магазин', receipt.shop_name ?? '—'],
    ['ФН · ФД · ФП', receipt.fn && receipt.fd && receipt.fp ? `…${receipt.fn.slice(-4)} · ${receipt.fd} · ${receipt.fp}` : '—'],
  ]

  return (
    <div className="vliq-review-summary" data-testid="review-card-summary">
      <div className="vliq-review-summary__seller">
        <Avatar initials={initials(sellerName)} size={36} className="rounded-[12px] flex-none" />
        <div style={{ flex: 1, minWidth: 0 }}>
          {onSellerClick ? (
            <button
              type="button"
              {...control}
              onClick={() => onSellerClick(receipt.seller_id)}
              aria-label={`Открыть продавца ${sellerName}`}
              className="vliq-review-summary__seller-name is-link"
            >
              {sellerName}
            </button>
          ) : (
            <b className="vliq-review-summary__seller-name">{sellerName}</b>
          )}
          <span className="vliq-review-summary__muted">{receipt.seller_store ?? '—'}</span>
        </div>
        <Pill kind={receipt.duplicate_status === 'danger' ? 'dg' : 'ok'} className="flex-none">
          <Icon name={receipt.duplicate_status === 'danger' ? 'alert' : 'shield'} size={11} />
          <span style={{ whiteSpace: 'nowrap' }}>{receipt.duplicate_status === 'danger' ? 'Возможный дубль' : 'Уникален'}</span>
        </Pill>
      </div>

      <div className="vliq-review-summary__money">
        <div>
          <span className="vliq-review-summary__label">Сумма</span>
          <b className="vliq-review-summary__amount">{fmtMoney(receipt.amount)}</b>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="vliq-review-summary__label">Бонус</span>
          <b className="vliq-review-summary__bonus">
            {receipt.bonus_amount != null && receipt.bonus_amount > 0 ? fmtMoneyDelta(receipt.bonus_amount) : 'не назначен'}
          </b>
        </div>
      </div>

      <dl className="vliq-review-summary__rows">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>

      {/* Composition from the check source — no photo any more, this is what was bought. */}
      <div className="vliq-review-summary__items" aria-label="Состав чека">
        <span className="vliq-review-summary__label">Состав чека</span>
        <ReceiptItems
          items={receipt.items}
          max={3}
          empty={
            <span className="vliq-review-summary__muted" data-testid="receipt-items-empty">
              Появится после проверки в ФНС / ОФД
              {checkUrl && (
                <>
                  {' · '}
                  <a href={checkUrl} target="_blank" rel="noopener noreferrer" {...control}
                    style={{ color: 'var(--vliq-brand)', fontWeight: 700 }}>
                    открыть чек
                  </a>
                </>
              )}
            </span>
          }
        />
      </div>

      <div className="vliq-review-summary__chips">
        {receipt.source && <Pill kind="muted">{SOURCE_LABEL[receipt.source]}</Pill>}
        {verification && <Pill kind={VERIFICATION_KIND[verification]}>{verificationLabel(verification, receipt.verified_by)}</Pill>}
        {chips.slice(0, MAX_CHIPS).map((c) => <Pill key={c} kind="dg">{c}</Pill>)}
        {chips.length > MAX_CHIPS && <Pill kind="dg">+{chips.length - MAX_CHIPS}</Pill>}
      </div>

      <button type="button" {...control} onClick={onDetails} className="vliq-review-summary__details">
        <Icon name="zoom" size={16} />
        Подробнее
        {(files > 0 || items > 0) && (
          <span className="vliq-review-summary__muted" style={{ fontWeight: 600 }}>
            {[files > 0 && `${files} ${plural(files, ['файл', 'файла', 'файлов'])}`, items > 0 && `${items} ${plural(items, ['товар', 'товара', 'товаров'])}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </button>
    </div>
  )
}
