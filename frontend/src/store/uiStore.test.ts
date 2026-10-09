import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from './uiStore'

describe('uiStore — sheets opened from a sheet stack up (KAN-3 «назад»)', () => {
  beforeEach(() => useUiStore.getState().closeSheet())

  it('payout → receipt → «Назад» returns to the payout; close clears everything', () => {
    const { openSheet, backSheet, closeSheet } = useUiStore.getState()
    openSheet('payout', { payoutId: '5' })
    openSheet('detail', { receiptId: '11' })
    expect(useUiStore.getState()).toMatchObject({ activeSheet: 'detail', sheetStack: [{ sheet: 'payout' }] })

    backSheet()
    expect(useUiStore.getState()).toMatchObject({ activeSheet: 'payout', sheetPayload: { payoutId: '5' }, sheetStack: [] })

    openSheet('detail', { receiptId: '11' })
    closeSheet()
    expect(useUiStore.getState()).toMatchObject({ activeSheet: null, sheetStack: [] })
  })

  it('a sheet opened from a page (no sheet open) has nothing to go back to', () => {
    useUiStore.getState().openSheet('detail', { receiptId: '1' })
    expect(useUiStore.getState().sheetStack).toEqual([])
    useUiStore.getState().backSheet() // no-op
    expect(useUiStore.getState().activeSheet).toBe('detail')
  })
})
