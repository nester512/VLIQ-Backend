import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// The hidden catalog branch pulls the SKU api and the ui store — mock both so
// the placeholder test never touches the network layer.
vi.mock('@/api/sku', () => ({
  listSkus: vi.fn(),
  createSku: vi.fn(),
  deleteSku: vi.fn(),
}))
vi.mock('@/store/uiStore', () => ({
  useUiStore: (selector: (s: { pushToast: () => void }) => unknown) =>
    selector({ pushToast: () => {} }),
}))

import { ProductsPage } from './ProductsPage'

afterEach(() => cleanup())

describe('ProductsPage — MVP placeholder (KAN-21)', () => {
  it('renders the "available later" stub without MVP jargon', () => {
    render(<ProductsPage />)

    expect(screen.getByText('Раздел товаров будет доступен позже')).toBeTruthy()
    expect(screen.queryByText(/MVP/i)).toBeNull()
    // The catalog UI (search, form) stays hidden.
    expect(screen.queryByPlaceholderText(/поиск/i)).toBeNull()
  })
})
