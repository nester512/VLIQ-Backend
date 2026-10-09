import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getReceiptJourney, verifyReceiptNow, type JourneyEvent, type ReceiptJourney } from '@/api/admin'
import { extractApiError } from '@/api/client'
import { Pill } from '@/components/atoms/Pill'
import { Spinner } from '@/components/atoms/Spinner'
import { formatDateTime } from '@/utils/formatDate'
import { fmtMoney } from '@/utils/formatMoney'
import { useUiStore } from '@/store/uiStore'
import { invalidateAfterReceiptChange } from '@/features/admin/invalidate'
import {
  EVENT_KIND,
  EVENT_LABEL,
  METHOD_LABEL,
  OUTCOME_LABEL,
  SOURCE_LABEL,
  TRIGGER_LABEL,
  VERIFICATION_KIND,
  providerLabel,
  verificationLabel,
} from '@/features/admin/verificationLabels'
import type { ReceiptSourceT } from '@/api/admin'

const DECISION_LABEL = { approved: 'Одобрен', rejected: 'Отклонён', sent_to_revision: 'На доработке' } as const

function actorLabel(e: JourneyEvent): string {
  if (e.actor_type === 'seller') return 'продавец'
  if (e.actor_type === 'admin') return e.actor_id ? `админ ${e.actor_id}` : 'админ'
  return 'система'
}

const kop = (v: unknown) => (typeof v === 'number' ? fmtMoney(v) : '—')

/** The one-line detail of a step, from its compact `data`. */
function eventDetail(e: JourneyEvent): string | null {
  const d = e.data ?? {}
  switch (e.kind) {
    case 'received':
      return [e.source && (SOURCE_LABEL[e.source as ReceiptSourceT] ?? e.source), typeof d.total_sum === 'number' && kop(d.total_sum)]
        .filter(Boolean).join(' · ') || null
    case 'risk_flagged':
      return Array.isArray(d.signals) ? d.signals.join(', ') : null
    case 'check_round_started': {
      const providers = Array.isArray(d.providers) ? (d.providers as string[]).map(providerLabel) : []
      return `№${d.round ?? '?'} · ${providers.length ? providers.join(' → ') : 'нет подключённых источников'}`
    }
    case 'provider_checked':
    case 'provider_skipped':
    case 'verified':
      return [providerLabel(e.source), e.outcome && e.kind === 'provider_checked' && OUTCOME_LABEL[e.outcome as keyof typeof OUTCOME_LABEL]]
        .filter(Boolean).join(' · ')
    case 'check_round_failed':
    case 'check_exhausted':
      if (d.reason === 'no_provider_available') return 'нет подключённых источников'
      return typeof d.next_at === 'string' ? `следующий раунд ${formatDateTime(d.next_at)}` : null
    case 'approved':
      return typeof d.bonus_amount === 'number' ? `бонус ${kop(d.bonus_amount)}` : null
    case 'rejected':
      return typeof d.reason === 'string' ? d.reason : null
    case 'bonus_changed':
      return [`${kop(d.before)} → ${kop(d.after)}`, typeof d.reason === 'string' && d.reason].filter(Boolean).join(' · ')
    case 'included_in_payout':
    case 'paid_out':
    case 'payout_reverted': {
      const part = d.partial === true ? ' (частично)' : ''
      return [
        typeof d.payout_id === 'number' && `заявка #${d.payout_id}`,
        typeof d.amount === 'number' && `${kop(d.amount)}${part}`,
        typeof d.reason === 'string' && d.reason,
      ].filter(Boolean).join(' · ') || null
    }
    case 'deleted':
      return [typeof d.reason === 'string' && d.reason, typeof d.bonus_reversed === 'number' && `списано ${kop(d.bonus_reversed)}`]
        .filter(Boolean).join(' · ') || null
    case 'comment_added':
      return typeof d.text === 'string' ? d.text : null
    default:
      return null
  }
}

function Summary({ j }: { j: ReceiptJourney }) {
  const s = j.summary
  const rows: Array<[string, string]> = [
    ['Получен', [s.received_at && formatDateTime(s.received_at), s.intake_source && (SOURCE_LABEL[s.intake_source as ReceiptSourceT] ?? s.intake_source)].filter(Boolean).join(' · ') || '—'],
    [
      'Проверка',
      s.verification_status === 'verified'
        ? `${verificationLabel('verified', s.verified_by)}${s.verified_at ? ` · ${formatDateTime(s.verified_at)}` : ''}`
        : `${verificationLabel(s.verification_status)}${s.check_rounds ? ` · раундов ${s.check_rounds}` : ''}${s.next_check_at && s.verification_status === 'retrying' ? ` · следующий ${formatDateTime(s.next_check_at)}` : ''}`,
    ],
    ['Решение', s.decision ? `${DECISION_LABEL[s.decision]} · ${s.decided_at ? formatDateTime(s.decided_at) : ''}${s.decided_by ? ` · админ ${s.decided_by}` : ''}` : 'ещё нет'],
  ]
  return (
    <dl className="vliq-journey__summary">
      {rows.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  )
}

function CheckDetails({ e }: { e: JourneyEvent }) {
  const c = e.check
  if (!c) return null
  return (
    <div className="vliq-journey__check">
      <div>
        раунд {c.round_no ?? '—'} · {c.provider_role === 'main' ? 'основной' : 'запасной'} · {TRIGGER_LABEL[c.trigger]} ·{' '}
        {METHOD_LABEL[c.method] ?? c.method} · адаптер v{c.adapter_version ?? '?'}
        {c.http_status != null && ` · HTTP ${c.http_status}`}
        {c.duration_ms != null && ` · ${c.duration_ms} мс`}
      </div>
      <pre>{JSON.stringify({ request: c.request, parsed: c.parsed, response: c.response, error: c.error }, null, 2)}</pre>
    </div>
  )
}

/**
 * «Путь чека» — the receipt's whole journey (docs/design/RECEIPT-JOURNEY.md):
 * received → checked (by which source, when, with what result) → decided.
 * Every provider check expands to the exact request and the raw answer.
 */
export function JourneyPanel({ receiptId }: { receiptId: string }) {
  const qc = useQueryClient()
  const pushToast = useUiStore((s) => s.pushToast)
  const [open, setOpen] = useState<number | null>(null)
  const key = ['admin', 'receipt-journey', receiptId]

  const { data: j, isLoading, isError } = useQuery({ queryKey: key, queryFn: () => getReceiptJourney(receiptId), staleTime: 10_000 })

  const { mutate: verify, isPending, variables } = useMutation({
    mutationFn: (provider?: string) => verifyReceiptNow(receiptId, provider),
    onSuccess: (fresh) => {
      qc.setQueryData(key, fresh)
      invalidateAfterReceiptChange(qc)
      const ok = fresh.summary.verification_status === 'verified'
      pushToast(ok ? verificationLabel('verified', fresh.summary.verified_by) : 'Не подтверждён — см. путь чека', ok ? 'ok' : 'wn')
    },
    onError: (err) => pushToast(extractApiError(err).userMessage, 'dg'),
  })

  if (isLoading) return <div style={{ display: 'grid', placeItems: 'center', padding: 16 }}><Spinner size={22} /></div>
  if (isError || !j) return null

  const connected = j.providers.filter((p) => p.available)
  const checkable = j.summary.verification_status !== 'not_required'

  return (
    <section className="vliq-card vliq-journey" data-testid="journey-panel">
      <div className="vliq-journey__head">
        <b>Путь чека</b>
        <Pill kind={VERIFICATION_KIND[j.summary.verification_status]}>
          {verificationLabel(j.summary.verification_status, j.summary.verified_by)}
        </Pill>
      </div>

      <Summary j={j} />

      {checkable && (
        <div className="vliq-journey__actions">
          <button type="button" disabled={isPending} onClick={() => verify(undefined)} className="vliq-journey__btn is-primary">
            {isPending && variables === undefined ? 'Проверяем…' : 'Проверить сейчас'}
          </button>
          {connected.map((p) => (
            <button key={p.code} type="button" disabled={isPending} onClick={() => verify(p.code)} className="vliq-journey__btn">
              {isPending && variables === p.code ? '…' : `у ${providerLabel(p.code)}`}
            </button>
          ))}
        </div>
      )}

      <div className="vliq-journey__providers" aria-label="Источники проверки">
        {j.providers.filter((p) => p.code !== 'fake' || p.available).map((p) => (
          <span key={p.code} title={p.title}>
            {p.priority}. {providerLabel(p.code)}{' '}
            <Pill kind={!p.enabled ? 'muted' : !p.available ? 'muted' : p.disabled_until ? 'wn' : 'ok'}>
              {!p.enabled ? 'выключен' : !p.available ? 'не подключён' : p.disabled_until ? 'пауза' : p.role === 'main' ? 'основной' : 'запасной'}
            </Pill>
          </span>
        ))}
      </div>

      <ol className="vliq-journey__events">
        {j.events.map((e) => {
          const detail = eventDetail(e)
          const expandable = Boolean(e.check)
          return (
            <li key={e.seq} data-kind={e.kind} className={`is-${EVENT_KIND[e.kind] ?? 'muted'}`}>
              <button
                type="button"
                disabled={!expandable}
                aria-expanded={expandable ? open === e.seq : undefined}
                onClick={() => setOpen(open === e.seq ? null : e.seq)}
                className="vliq-journey__event"
              >
                <span className="vliq-journey__time">{formatDateTime(e.at)}</span>
                <span className="vliq-journey__what">
                  <b>{EVENT_LABEL[e.kind] ?? e.kind}</b>
                  {detail && <span> — {detail}</span>}
                  <span className="vliq-journey__who"> · {actorLabel(e)}{e.data?.backfilled ? ' · восстановлено' : ''}</span>
                </span>
              </button>
              {open === e.seq && <CheckDetails e={e} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
