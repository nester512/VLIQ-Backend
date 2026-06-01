interface NameLike {
  first_name?: string | null
  last_name?: string | null
}

/** Two-character uppercase initials, falling back to `??`. */
export function getInitials(p: NameLike): string {
  const first = (p.first_name ?? '').trim()
  const last = (p.last_name ?? '').trim()
  const initials = [first, last]
    .filter(Boolean)
    .map((s) => s[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return initials || '??'
}

/** Initials from an arbitrary display name like "Алексей Морозов". */
export function initialsFromName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return parts
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase() || '??'
}

/** "Алексей Морозов" or a `#id` fallback. */
export function getFullName(p: NameLike, idFallback?: number | string): string {
  const joined = [p.first_name, p.last_name].filter(Boolean).join(' ').trim()
  if (joined) return joined
  return idFallback !== undefined ? `Продавец #${idFallback}` : 'Без имени'
}
