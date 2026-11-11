/**
 * Bank search for the payout form (UC-S7 «Банк получателя»): forgiving on purpose.
 *  - case, «ё», quotes, dashes and brackets do not matter: «альфа» finds «АЛЬФА-БАНК»;
 *  - every typed word may be the start of any word of the name: «моск кред» → «МОСКОВСКИЙ КРЕДИТНЫЙ БАНК»;
 *  - a word typed in the wrong keyboard layout still works: «cnth» = «сбер»;
 *  - common short and Latin names: «тинькофф», «tinkoff» → «Т-Банк»; «мкб» → «МОСКОВСКИЙ КРЕДИТНЫЙ БАНК».
 * Popular banks rank first among equal matches; the list order is kept otherwise.
 */

export interface SbpBank {
  id: string
  name: string
  popular: boolean
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё'
const LAYOUT: Record<string, string> = Object.fromEntries([...EN].map((c, i) => [c, RU[i]!]))

/** Words that are in almost every name — typing them alone should not list every bank. */
const FILLER = new Set(['банк', 'bank', 'кб', 'акб', 'ао', 'пао', 'ооо', 'нко', 'пнко', 'рнко', 'ко'])

/** Names people use that are not in the NSPK name (by NSPK member id). */
const ALIASES: Record<string, string[]> = {
  '100000000111': ['сбер', 'sber', 'sberbank', 'сбербанк'],
  '100000000004': ['тинькофф', 'тиньков', 'тинек', 'tinkoff', 'tbank', 'т банк', 'тбанк'],
  '110000000005': ['vtb', 'втб'],
  '100000000008': ['alfa', 'alfabank', 'альфа'],
  '100000000001': ['gazprom', 'gpb', 'гпб'],
  '100000000273': ['ozon', 'озон'],
  '100000000150': ['yandex', 'яндекс банк'],
  '100000000259': ['wildberries', 'wb', 'вб', 'вайлдберриз'],
  '100000000013': ['sovcom', 'халва'],
  '100000000007': ['raif', 'raiffeisen', 'райф'],
  '100000000017': ['mts', 'мтс'],
  '100000000010': ['psb', 'промсвязьбанк', 'псб'],
  '100000000020': ['rshb', 'россельхозбанк'],
  '100000000025': ['mkb', 'мкб', 'credit bank of moscow'],
  '100000000003': ['синара', 'sinara', 'скб'],
  '100000000026': ['уралсиб', 'uralsib'],
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`()\-–—.,/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** «cnth» → «стер»: what the same keys give in the Russian layout. */
export function fromLatinLayout(s: string): string {
  return [...s.toLowerCase()].map((c) => LAYOUT[c] ?? c).join('')
}

function words(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean)
}

/** 3 — the name starts with the query, 2 — every query word starts a name word, 1 — inside a word. */
function score(queryWords: string[], name: string): number {
  const n = normalize(name)
  const nw = n.split(' ')
  const q = queryWords.join(' ')
  if (n.startsWith(q)) return 3
  if (queryWords.every((qw) => nw.some((w) => w.startsWith(qw)))) return 2
  if (q.length >= 3 && n.replace(/ /g, '').includes(q.replace(/ /g, ''))) return 1
  return 0
}

function best(queryWords: string[], bank: SbpBank): number {
  const names = [bank.name, ...(ALIASES[bank.id] ?? [])]
  return Math.max(...names.map((n) => score(queryWords, n)))
}

export function searchBanks(banks: SbpBank[], query: string): SbpBank[] {
  let qw = words(query)
  const meaningful = qw.filter((w) => !FILLER.has(w))
  if (meaningful.length) qw = meaningful
  if (!qw.length) return banks
  const ranked = (ws: string[]) =>
    banks
      .map((b, i) => ({ b, i, s: best(ws, b) }))
      .filter((x) => x.s > 0)
      .sort((a, z) => z.s - a.s || Number(z.b.popular) - Number(a.b.popular) || a.i - z.i)
      .map((x) => x.b)
  const direct = ranked(qw)
  if (direct.length) return direct
  // Nothing found: maybe the keyboard was in the Latin layout.
  const swapped = words(fromLatinLayout(query)).filter((w) => !FILLER.has(w))
  return swapped.length ? ranked(swapped) : []
}
