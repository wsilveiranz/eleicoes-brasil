import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

test('renders accessible content with the component test harness', () => {
  render(<main><h1>Eleições Brasil</h1></main>)

  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Eleições Brasil' })).toBeVisible()
})
