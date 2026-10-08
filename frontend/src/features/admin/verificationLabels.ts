import type { ReceiptSourceT, VerificationAttempt, VerificationStatus } from '@/api/admin'

export const SOURCE_LABEL: Record<ReceiptSourceT, string> = {
  telegram_scan: 'QR · сканер Telegram',
  camera_scan: 'QR · камера',
  image_decode: 'QR · из фото',
  pdf_decode: 'QR · из PDF',
  manual: 'Ручной ввод данных',
}

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  not_required: 'Не проверяется',
  pending: 'Проверка в ОФД…',
  retrying: 'ОФД: повтор по расписанию',
  verified: 'Подтверждён в ОФД',
  failed: 'ОФД: не подтверждён',
}

export const VERIFICATION_KIND: Record<VerificationStatus, 'ok' | 'wn' | 'dg' | 'muted'> = {
  not_required: 'muted',
  pending: 'muted',
  retrying: 'wn',
  verified: 'ok',
  failed: 'dg',
}

export const OUTCOME_LABEL: Record<VerificationAttempt['outcome'], string> = {
  ok: 'найден',
  not_found: 'нет данных',
  invalid: 'чек некорректен',
  rate_limited: 'лимит провайдера',
  error: 'ошибка',
  blocked: 'доступ отклонён',
}

export const TRIGGER_LABEL: Record<VerificationAttempt['trigger'], string> = {
  pipeline: 'при загрузке',
  cron: 'по расписанию',
  admin: 'вручную',
}

export const METHOD_LABEL: Record<string, string> = {
  fields: 'по реквизитам',
  qrraw: 'по строке QR',
  fields_seconds: 'по реквизитам (с секундами)',
}
