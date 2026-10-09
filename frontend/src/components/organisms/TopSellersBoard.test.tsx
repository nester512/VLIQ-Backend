import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopSellersBoard } from './TopSellersBoard'

describe('TopSellersBoard — ranked by accrued for all time', () => {
  it('keeps the server order and shows «начислено» as the main figure', () => {
    render(
      <TopSellersBoard
        sellers={[
          { telegram_id: 2, name: 'Второй-по-чекам', city: 'Москва', receipts: '1 одобрено', accrued: 800000, sales: 10, paid: 0 },
          { telegram_id: 1, name: 'Первый-по-чекам', city: 'Москва', receipts: '4 одобрено', accrued: 400000, sales: 70000, paid: 12000 },
        ]}
      />,
    )
    const accrued = screen.getAllByTestId('top-seller-accrued').map((el) => el.textContent)
    expect(accrued[0]).toMatch(/8\s?000/)
    expect(accrued[1]).toMatch(/4\s?000/)
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Второй-по-чекам')
  })
})
