/**
 * Receipts already sent from THIS device (ФН:ФД:ФП) — a local guard against an
 * accidental double send. Not a rule: the seller may still resend (the server
 * only warns about duplicates). Storage may be unavailable → silently a no-op.
 */
const KEY = 'vliq.sentReceipts'
const LIMIT = 300

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function wasSentFromThisDevice(fiscalKey: string): boolean {
  return read().includes(fiscalKey)
}

export function rememberSent(fiscalKey: string): void {
  try {
    const list = [fiscalKey, ...read().filter((k) => k !== fiscalKey)].slice(0, LIMIT)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage unavailable — the server-side duplicate warning still applies */
  }
}
