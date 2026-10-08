import type { SellerRiskLevel } from '@/api/admin'

export const RISK_LABEL: Record<SellerRiskLevel, string> = {
  low: 'Низкий риск',
  medium: 'Средний риск',
  high: 'Высокий риск',
}

export const RISK_KIND: Record<SellerRiskLevel, 'ok' | 'wn' | 'dg'> = { low: 'ok', medium: 'wn', high: 'dg' }

/** Human-readable reasons behind the risk score (backend sends codes). */
export const RISK_FLAG_LABEL: Record<string, string> = {
  low_data: 'Мало решений по чекам — оценка неточная',
  high_reject_rate: 'Высокая доля отклонённых чеков',
  duplicates: 'Есть чеки с признаками дубля',
}
