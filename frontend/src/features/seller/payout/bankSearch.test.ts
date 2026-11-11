import { describe, expect, it } from 'vitest'
import { fromLatinLayout, searchBanks, type SbpBank } from './bankSearch'

// Names exactly as NSPK publishes them (backend/src/payout_request/sbp_banks.py).
const BANKS: SbpBank[] = [
  { id: '100000000111', name: 'Сбербанк', popular: true },
  { id: '100000000004', name: 'Т-Банк', popular: true },
  { id: '110000000005', name: 'Банк ВТБ', popular: true },
  { id: '100000000008', name: 'АЛЬФА-БАНК', popular: true },
  { id: '100000000259', name: 'ВБ Банк (Вайлдберриз банк)', popular: true },
  { id: '100000000025', name: 'МОСКОВСКИЙ КРЕДИТНЫЙ БАНК', popular: false },
  { id: '100000000183', name: 'КБ Пойдём!', popular: false },
  { id: '100000000015', name: 'Банк ВБРР', popular: false },
  { id: '100000000050', name: 'КБ Кубань Кредит', popular: false },
]
const names = (q: string) => searchBanks(BANKS, q).map((b) => b.name)

describe('bank search (UC-S7 «Банк получателя»)', () => {
  it('case and punctuation do not matter', () => {
    expect(names('альфа')[0]).toBe('АЛЬФА-БАНК')
    expect(names('СБЕР')[0]).toBe('Сбербанк')
    expect(names('т банк')[0]).toBe('Т-Банк')
  })

  it('the names people use: тинькофф, tinkoff, wildberries, мкб', () => {
    expect(names('тинькофф')).toEqual(['Т-Банк'])
    expect(names('Tinkoff')).toEqual(['Т-Банк'])
    expect(names('wildberries')).toEqual(['ВБ Банк (Вайлдберриз банк)'])
    expect(names('мкб')[0]).toBe('МОСКОВСКИЙ КРЕДИТНЫЙ БАНК')
  })

  it('word starts in any order: «кред моск»', () => {
    expect(names('кред моск')).toEqual(['МОСКОВСКИЙ КРЕДИТНЫЙ БАНК'])
  })

  it('«ё» and «е» are the same', () => {
    expect(names('пойдем')).toEqual(['КБ Пойдём!'])
  })

  it('«банк» alone is not a search word: «банк втб» finds ВТБ first', () => {
    expect(names('банк втб')[0]).toBe('Банк ВТБ')
  })

  it('a popular bank comes before others that match as well', () => {
    expect(names('вб')).toEqual(['ВБ Банк (Вайлдберриз банк)', 'Банк ВБРР'])
  })

  it('typed in the Latin layout by mistake', () => {
    expect(fromLatinLayout('cnth')).toBe('стер')
    expect(names(',fyr dn,')[0]).toBe('Банк ВТБ') // «банк втб» on an English keyboard
  })

  it('empty search — the whole list as it came; nonsense — nothing', () => {
    expect(names('  ')).toEqual(BANKS.map((b) => b.name))
    expect(names('росбанк')).toEqual([])
  })
})
