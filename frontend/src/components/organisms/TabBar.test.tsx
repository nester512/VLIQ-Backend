import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TabBar } from './TabBar'

describe('TabBar — admin MVP navigation', () => {
  it('hides the deferred product section while retaining the other admin destinations', () => {
    render(
      <MemoryRouter>
        <TabBar mode="admin" />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /Обзор/i })).toHaveAttribute('href', '/admin/dash')
    expect(screen.getByRole('link', { name: /Чеки/i })).toHaveAttribute('href', '/admin/review')
    expect(screen.queryByRole('link', { name: /Товары/i })).toBeNull()
  })
})
