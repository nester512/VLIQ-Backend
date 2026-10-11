import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FilterPills } from './FilterPills'

afterEach(cleanup)

describe('FilterPills — narrow screens (Flip 7)', () => {
  it('wraps to the next line instead of a hidden horizontal scroll that cut the last pill', () => {
    render(<FilterPills options={[{ value: 'a', label: 'Все' }, { value: 'b', label: 'Отклонены' }]} value="a" onChange={() => {}} />)
    const row = screen.getByRole('button', { name: 'Все' }).parentElement!
    expect(row.style.flexWrap).toBe('wrap')
    expect(row.style.overflowX).toBe('')
  })
})
