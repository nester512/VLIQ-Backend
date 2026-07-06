import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// PromoActualPage (hidden behind the placeholder flag) pulls the promotions
// hook — mock it so the placeholder test never touches the network layer.
vi.mock('../hooks/usePromotions', () => ({
  usePromotions: () => ({ data: [], isLoading: false }),
}))

import { PromoPage } from './PromoPage'

afterEach(() => cleanup())

describe('PromoPage — MVP placeholder (KAN-6)', () => {
  it('renders the "available later" stub without MVP jargon', () => {
    render(<PromoPage />)

    expect(screen.getByText('Раздел «Акции» будет доступен позже')).toBeTruthy()
    // The screen must not confuse users with internal terms.
    expect(screen.queryByText(/MVP/i)).toBeNull()
    // The actual promotions UI stays hidden.
    expect(screen.queryByText('Сейчас акций нет')).toBeNull()
  })
})
