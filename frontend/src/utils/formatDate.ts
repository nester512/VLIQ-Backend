const DATE_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const DATE_ONLY_FMT = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/**
 * Format ISO date string to Russian format with time.
 * Example: "2026-05-18T14:02:00Z" → "18.05.2026, 14:02"
 */
export function formatDateTime(isoStr: string): string {
  return DATE_FMT.format(new Date(isoStr))
}

/**
 * Format ISO date string to Russian date only.
 * Example: "2026-05-18T14:02:00Z" → "18.05.2026"
 */
export function formatDate(isoStr: string): string {
  return DATE_ONLY_FMT.format(new Date(isoStr))
}

/**
 * Returns relative label: "Сегодня" / "Вчера" / formatted date.
 */
export function formatRelativeDate(isoStr: string): string {
  const date = new Date(isoStr)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()

  if (isToday) return 'Сегодня'
  if (isYesterday) return 'Вчера'
  return formatDate(isoStr)
}
