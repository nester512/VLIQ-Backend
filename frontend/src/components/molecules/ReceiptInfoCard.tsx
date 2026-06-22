import type { ReactNode } from 'react'
import { Icon } from '@/components/atoms/Icon'
import { Pill } from '@/components/atoms/Pill'
import { fmtMoney, fmtMoneyDelta } from '@/utils/formatMoney'
import { formatDate, formatDateTime } from '@/utils/formatDate'
import type { AdminReceipt, FiscalIdentity } from '@/api/admin'

const STATUS_LABEL: Record<string, string> = {
  pending: 'Ожидает',
  ocr_in_progress: 'OCR',
  on_review: 'На проверке',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  needs_revision: 'Доработка',
  paid_out: 'Выплачен',
}

function fiscalLine(idn: FiscalIdentity): string {
  const fn = idn.fn ? idn.fn.slice(-6) : '—'
  const fd = idn.fd ?? '—'
  const fp = idn.fp ? idn.fp.slice(-4) : '—'
  return `ФН …${fn} / ФД ${fd} / ФП …${fp}`
}

/** One label/value cell in the recognised-data grid. */
function Field({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <div className="text-[11.5px] font-medium text-[var(--vliq-hint)] mb-0.5">{label}</div>
      <div className="text-[14px] font-semibold text-[var(--vliq-text)] leading-snug break-words">
        {value}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <b className="text-[14px] font-bold block mb-1.5">{title}</b>
      {children}
    </div>
  )
}

export interface ReceiptInfoCardProps {
  receipt: AdminReceipt
  /** Optional action row (approve/reject buttons) rendered by the host. */
  actions?: ReactNode
  className?: string
}

/**
 * Reusable receipt summary card — fiscal fields, seller, duplicate/fraud
 * signals, the system-rejection reason (e.g. MULTIPLE_RECEIPTS_DETECTED) and
 * OCR extraction warnings. Shared by SwipeDeck's final viewer page and the
 * ReceiptDetailSheet so the same data renders identically in both places.
 */
export function ReceiptInfoCard({ receipt, actions, className = '' }: ReceiptInfoCardProps) {
  const sellerName = receipt.seller_name ?? `Продавец #${receipt.seller_id}`
  const sellerStore = receipt.seller_store ?? '—'
  const dupStatus = receipt.duplicate_status ?? 'ok'
  const statusLabel = STATUS_LABEL[receipt.status] ?? receipt.status

  const fnTriple =
    receipt.fn && receipt.fd && receipt.fp
      ? `${receipt.fn.slice(-6)} / ${receipt.fd} / ${receipt.fp.slice(-4)}`
      : '—'

  // Distinct identities are only worth showing when there is more than one
  // (the single-identity case is already covered by the ФН/ФД/ФП field).
  const multiIdentities =
    receipt.detected_identities && receipt.detected_identities.length > 1
      ? receipt.detected_identities
      : []

  const fraudSignals = receipt.fraud_signal ?? []
  const warnings = receipt.extraction_warnings ?? []

  return (
    <div className={className} data-testid="receipt-info-card">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-[16px] leading-tight">Чек #{receipt.id}</div>
          <div className="text-[12.5px] text-[var(--vliq-hint)] font-medium truncate">
            {sellerName} · {sellerStore}
          </div>
        </div>
        <Pill kind={dupStatus === 'ok' ? 'ok' : 'wn'}>{statusLabel}</Pill>
      </div>

      {/* Recognised fiscal data */}
      <Section title="Распознанные данные">
        <div className="bg-[var(--vliq-field)] rounded-[16px] p-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Пользователь" value={sellerName} />
          <Field label="Торговая точка" value={sellerStore} />
          <Field
            label="Дата покупки"
            value={receipt.purchase_date ? formatDate(receipt.purchase_date) : '—'}
          />
          <Field label="Дата загрузки" value={formatDateTime(receipt.created_at)} />
          <Field label="Сумма покупки" value={fmtMoney(receipt.amount)} />
          <Field
            label="Бонус"
            value={
              receipt.bonus_amount != null && receipt.bonus_amount > 0
                ? fmtMoneyDelta(receipt.bonus_amount)
                : '—'
            }
          />
          <Field label="Магазин" value={receipt.shop_name ?? '—'} wide />
          <Field label="Адрес" value={receipt.shop_address ?? '—'} wide />
          <Field label="ФН / ФД / ФП" value={fnTriple} wide />
        </div>
      </Section>

      {/* Multiple distinct fiscal identities (MULTIPLE_RECEIPTS_DETECTED) */}
      {multiIdentities.length > 0 && (
        <Section title={`Найдено разных чеков: ${multiIdentities.length}`}>
          <div className="bg-[var(--vliq-dg-bg)] rounded-[14px] p-3.5 flex flex-col gap-1.5">
            {multiIdentities.map((idn, i) => (
              <div
                key={i}
                className="text-[12.5px] font-medium text-[var(--vliq-dg-ink)]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fiscalLine(idn)}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Rejection reason + machine code. The code is present only for SYSTEM
          rejections (e.g. MULTIPLE_RECEIPTS_DETECTED) — it stays NULL for ordinary
          admin rejections, which lets the admin tell the two apart. */}
      {(receipt.rejection_reason || receipt.rejection_code) && (
        <div className="flex gap-2 items-start rounded-[14px] px-4 py-3 mb-3 text-[13px] font-medium bg-[var(--vliq-dg-bg)] text-[var(--vliq-dg-ink)]">
          <Icon name="alert" size={16} className="flex-none mt-0.5" />
          <span>
            <b>Причина отклонения:</b> {receipt.rejection_reason ?? '—'}
            {receipt.rejection_code && (
              <span className="block mt-1 opacity-70">
                Системный код: <code>{receipt.rejection_code}</code>
              </span>
            )}
          </span>
        </div>
      )}

      {/* Duplicate / fraud signals (human-readable). */}
      {fraudSignals.length > 0 && (
        <Section title="Сигналы проверки">
          <div className="flex flex-col gap-2">
            {fraudSignals.map((s, i) => (
              <div
                key={`${s.type}-${i}`}
                className="flex gap-2 items-start rounded-[14px] px-4 py-3 text-[13px] font-medium bg-[var(--vliq-wn-bg)] text-[var(--vliq-wn-ink)]"
              >
                <Icon name="alert" size={16} className="flex-none mt-0.5" />
                <span>
                  {s.details}
                  {s.duplicate_of_id != null && (
                    <span className="opacity-80"> (чек #{s.duplicate_of_id})</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* OCR extraction warnings. */}
      {warnings.length > 0 && (
        <Section title="Предупреждения распознавания">
          <ul className="bg-[var(--vliq-field)] rounded-[14px] p-3.5 flex flex-col gap-1.5 list-none">
            {warnings.map((w, i) => (
              <li key={i} className="text-[12.5px] text-[var(--vliq-hint)] flex gap-2">
                <Icon name="alert" size={14} className="flex-none mt-0.5 text-[var(--vliq-wn-ink)]" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* When everything is clean, reassure the admin explicitly. */}
      {fraudSignals.length === 0 && !receipt.rejection_reason && warnings.length === 0 && (
        <div className="flex gap-2 items-center rounded-[14px] px-4 py-3 mb-3 text-[13px] font-medium bg-[var(--vliq-ok-bg)] text-[var(--vliq-ok-ink)]">
          <Icon name="shield" size={16} className="flex-none" />
          <span>Подозрительной активности не выявлено</span>
        </div>
      )}

      {actions}
    </div>
  )
}
