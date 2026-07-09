/**
 * KAN-12: external receipt-verification link for the admin review UI.
 *
 * check.ofd.ru exposes public receipt permalinks in the form
 * `/rec/{ФН}/{ФД}/{ФП}` — the only major verification site that accepts the
 * fiscal triple straight in the URL (proverkacheka.com is form/API-only).
 * For receipts registered with a different ОФД the page shows «чек не
 * найден» — the admin then falls back to the «Скопировать ФН / ФД / ФП»
 * button and pastes the triple into any checker manually.
 */
export function receiptCheckUrl(receipt: {
  fn?: string | null
  fd?: string | null
  fp?: string | null
}): string | null {
  const { fn, fd, fp } = receipt
  if (!fn || !fd || !fp) return null
  return `https://check.ofd.ru/rec/${encodeURIComponent(fn)}/${encodeURIComponent(fd)}/${encodeURIComponent(fp)}`
}
