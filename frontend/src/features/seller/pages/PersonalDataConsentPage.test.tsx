import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { PersonalDataConsentPage } from './PersonalDataConsentPage'

afterEach(cleanup)

describe('PersonalDataConsentPage', () => {
  it('renders a distinct personal-data-consent page', () => {
    render(
      <MemoryRouter>
        <PersonalDataConsentPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Согласие на обработку персональных данных' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Оферта №1' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Назад' })).toBeInTheDocument()
  })
})
