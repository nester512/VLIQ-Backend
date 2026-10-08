import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getReceiptVerification, verifyReceiptNow } from '@/api/admin'
import { extractApiError } from '@/api/client'
import { Pill } from '@/components/atoms/Pill'
import { Spinner } from '@/components/atoms/Spinner'
import { formatDateTime } from '@/utils/formatDate'
import { useUiStore } from '@/store/uiStore'
import { invalidateAfterReceiptChange } from '@/features/admin/invalidate'
import {
  METHOD_LABEL,
  OUTCOME_LABEL,
  SOURCE_LABEL,
  TRIGGER_LABEL,
  VERIFICATION_KIND,
  VERIFICATION_LABEL,
} from '@/features/admin/verificationLabels'

/**
 * OFD check of a QR-intake receipt: current state, every attempt (newest first,
 * with request/response on demand) and «Проверить сейчас». Manual moderation
 * does not depend on it — it is evidence for the admin.
 */
export function VerificationPanel({ receiptId }: { receiptId: string }) {
  const qc = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const [open, setOpen] = useState<number | null>(null)
  const key = ['admin', 'receipt-verification', receiptId]

  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => getReceiptVerification(receiptId),
    staleTime: 10_000,
  })

  const { mutate: verify, isPending } = useMutation({
    mutationFn: () => verifyReceiptNow(receiptId),
    onSuccess: (fresh) => {
      qc.setQueryData(key, fresh)
      invalidateAfterReceiptChange(qc)
      const last = fresh.attempts[0]
      pushToast(last?.outcome === 'ok' ? 'Чек найден в ОФД' : `ОФД: ${last ? OUTCOME_LABEL[last.outcome] : 'нет ответа'}`, last?.outcome === 'ok' ? 'ok' : 'wn')
    },
    onError: (err) => pushToast(extractApiError(err).userMessage, 'dg'),
  })

  if (isLoading) {
    return <div style={{ display: 'grid', placeItems: 'center', padding: 16 }}><Spinner size={22} /></div>
  }
  if (isError || !data || data.status === 'not_required') return null

  return (
    <section className="vliq-card" style={{ margin: '0 16px 16px', padding: 16 }} data-testid="verification-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <b style={{ fontSize: 15, color: 'var(--vliq-text)' }}>Проверка в ОФД</b>
        <Pill kind={VERIFICATION_KIND[data.status]}>{VERIFICATION_LABEL[data.status]}</Pill>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--vliq-hint)', lineHeight: 1.6 }}>
        {data.source && <div>Источник данных: {SOURCE_LABEL[data.source]}</div>}
        <div>Попыток: {data.attempts_count}</div>
        {data.verified_at && <div>Подтверждён: {formatDateTime(data.verified_at)}</div>}
        {data.next_attempt_at && data.status === 'retrying' && <div>Следующая попытка: {formatDateTime(data.next_attempt_at)}</div>}
        {data.status === 'failed' && <div>Автоматические попытки исчерпаны — проверьте чек вручную.</div>}
      </div>

      <button
        type="button"
        onClick={() => verify()}
        disabled={isPending}
        style={{
          marginTop: 12, width: '100%', padding: 11, borderRadius: 12, border: 0, fontFamily: 'inherit',
          fontSize: 13, fontWeight: 700, background: 'var(--vliq-field)', color: 'var(--vliq-brand)',
          cursor: isPending ? 'default' : 'pointer', opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? 'Проверяем…' : 'Проверить сейчас'}
      </button>

      {data.attempts.length > 0 && (
        <ol style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {data.attempts.map((a) => (
            <li key={a.attempt_no} style={{ background: 'var(--vliq-field)', borderRadius: 12, padding: '9px 12px' }}>
              <button
                type="button"
                onClick={() => setOpen(open === a.attempt_no ? null : a.attempt_no)}
                aria-expanded={open === a.attempt_no}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}
              >
                <span style={{ color: 'var(--vliq-text)', fontWeight: 600 }}>
                  №{a.attempt_no} · {OUTCOME_LABEL[a.outcome]}
                </span>
                <span style={{ color: 'var(--vliq-hint)' }}>{formatDateTime(a.created_at)}</span>
              </button>
              <div style={{ fontSize: 11.5, color: 'var(--vliq-hint)', marginTop: 2 }}>
                {TRIGGER_LABEL[a.trigger]} · {METHOD_LABEL[a.method] ?? a.method} · {a.provider}
                {a.http_status != null && ` · HTTP ${a.http_status}`}
                {a.duration_ms != null && ` · ${a.duration_ms} мс`}
              </div>
              {open === a.attempt_no && (
                <pre style={{ margin: '8px 0 0', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--vliq-text)', maxHeight: 220, overflow: 'auto' }}>
                  {JSON.stringify({ request: a.request, response: a.response, error: a.error }, null, 2)}
                </pre>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
