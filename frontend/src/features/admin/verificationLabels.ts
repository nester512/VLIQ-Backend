import type { ReceiptCheck, ReceiptSourceT, VerificationStatus } from '@/api/admin'

export const SOURCE_LABEL: Record<ReceiptSourceT, string> = {
  telegram_scan: 'QR · сканер Telegram',
  camera_scan: 'QR · камера',
  image_decode: 'QR · из фото',
  pdf_decode: 'QR · из PDF',
  manual: 'Ручной ввод данных',
}

/** Any intake source in the admin's words — incl. the pre-QR file upload («upload»). */
export const intakeLabel = (source: string | null | undefined): string | null => {
  if (!source) return null
  if (source in SOURCE_LABEL) return SOURCE_LABEL[source as ReceiptSourceT]
  if (source === 'upload') return 'Фото / файл (до QR-приёма)'
  return source
}

/** Check providers — short names for chips and the timeline. */
export const PROVIDER_LABEL: Record<string, string> = {
  fns: 'ФНС',
  proverkacheka: 'Проверка чека',
  platformaofd: 'Платформа ОФД',
  taxcom: 'Такском',
  fake: 'заглушка (стенд)',
}
export const providerLabel = (code: string | null | undefined) => (code ? PROVIDER_LABEL[code] ?? code : '—')

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  not_required: 'Не проверяется',
  pending: 'Проверка…',
  retrying: 'Проверка: повтор по расписанию',
  verified: 'Подтверждён',
  failed: 'Не подтверждён',
}

/** «Подтверждён · ФНС» when we know who confirmed it. */
export const verificationLabel = (status: VerificationStatus, verifiedBy?: string | null) =>
  status === 'verified' && verifiedBy ? `Подтверждён · ${providerLabel(verifiedBy)}` : VERIFICATION_LABEL[status]

export const VERIFICATION_KIND: Record<VerificationStatus, 'ok' | 'wn' | 'dg' | 'muted'> = {
  not_required: 'muted',
  pending: 'muted',
  retrying: 'wn',
  verified: 'ok',
  failed: 'dg',
}

export const OUTCOME_LABEL: Record<ReceiptCheck['outcome'], string> = {
  ok: 'найден',
  not_found: 'нет данных',
  invalid: 'чек некорректен',
  rate_limited: 'лимит источника',
  error: 'ошибка источника',
  blocked: 'доступ отклонён',
}

export const TRIGGER_LABEL: Record<ReceiptCheck['trigger'], string> = {
  pipeline: 'при приёме',
  cron: 'по расписанию',
  admin: 'вручную',
}

export const METHOD_LABEL: Record<string, string> = {
  fields: 'по реквизитам',
  qrraw: 'по строке QR',
  fields_seconds: 'по реквизитам (с секундами)',
}

/** One line per journey step, in the admin's words. */
export const EVENT_LABEL: Record<string, string> = {
  received: 'Чек получен',
  validated: 'Данные проверены на телефоне и сервере',
  risk_flagged: 'Отмечены сигналы риска',
  sent_to_moderation: 'Передан на модерацию',
  check_round_started: 'Раунд проверки',
  provider_checked: 'Проверка у источника',
  provider_skipped: 'Источник пропущен (временно отключён)',
  verified: 'Подтверждён',
  check_round_failed: 'Раунд без подтверждения',
  check_exhausted: 'Автопроверка исчерпана — нужна ручная',
  recheck_requested: 'Запрошена повторная проверка',
  approved: 'Одобрен',
  rejected: 'Отклонён',
  sent_to_revision: 'Отправлен на доработку',
  bonus_changed: 'Изменён бонус',
  comment_added: 'Комментарий',
  edited: 'Данные изменены',
  reprocess_requested: 'Отправлен на повторную обработку',
  deleted: 'Удалён',
  included_in_payout: 'Включён в заявку на выплату',
  payout_reverted: 'Заявка на выплату отклонена — чек снова доступен',
  paid_out: 'Выплачен',
}

export const EVENT_KIND: Record<string, 'ok' | 'wn' | 'dg' | 'muted'> = {
  verified: 'ok',
  approved: 'ok',
  paid_out: 'ok',
  payout_reverted: 'wn',
  risk_flagged: 'dg',
  rejected: 'dg',
  check_exhausted: 'dg',
  deleted: 'dg',
  check_round_failed: 'wn',
  provider_skipped: 'wn',
  sent_to_revision: 'wn',
}
