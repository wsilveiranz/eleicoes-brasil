import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ElectionMetadata } from '../domain/geography'
import type { Selection } from '../domain/selection'
import { GeographyNavigation, MunicipalityNavigation } from './GeographyNavigation'

const metadata: ElectionMetadata = {
  election: { id: 'test', cycle: '2022', name: 'Presidente', date: '2022-10-30', year: 2022, round: '2' },
  states: [
    { code: 'sp', name: 'São Paulo', municipalities: [
      { code: '71072', name: 'São Paulo' },
      { code: '62910', name: 'Campinas' },
    ] },
    { code: 'rj', name: 'Rio de Janeiro', municipalities: [
      { code: '60011', name: 'Rio de Janeiro' },
    ] },
  ],
  countries: [
    { code: '990', name: 'Portugal', municipalities: [{ code: '00001', name: 'Lisboa' }] },
    { code: 'gov-fr', name: 'França', municipalities: [{ code: '00002', name: 'Paris' }] },
  ],
  overseasMunicipalities: [{ code: '00001', name: 'Lisboa' }, { code: '00002', name: 'Paris' }],
}

function Harness({ initial = { scope: 'domestic' }, onSelect = vi.fn() }: {
  initial?: Selection
  onSelect?: (selection: Selection) => void
}) {
  const [selection, setSelection] = useState(initial)
  const select = (next: Selection) => {
    setSelection(next)
    onSelect(next)
  }
  return <>
    <GeographyNavigation metadata={metadata} selection={selection} onSelect={select} />
    <MunicipalityNavigation metadata={metadata} selection={selection} onSelect={select} />
  </>
}

describe('GeographyNavigation', () => {
  it('keeps overview navigation free of table filters and municipality options', () => {
    render(<Harness />)
    expect(screen.queryByLabelText('Município')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Campinas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('preserves municipality drill-down and returning to the state summary', () => {
    const onSelect = vi.fn()
    render(<Harness initial={{ scope: 'domestic', state: 'sp' }} onSelect={onSelect} />)
    fireEvent.change(screen.getByLabelText('Município'), { target: { value: '71072' } })
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'domestic', state: 'sp', municipality: '71072' })
    fireEvent.change(screen.getByLabelText('Município'), { target: { value: '' } })
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'domestic', state: 'sp' })
  })

  it('searches municipalities without accents while retaining selected options', () => {
    render(<Harness initial={{ scope: 'domestic', state: 'sp', municipality: '71072' }} />)
    fireEvent.change(screen.getByLabelText('Buscar município'), { target: { value: 'sao' } })
    expect(within(screen.getByLabelText('Município')).queryByRole('option', { name: 'Campinas' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar município'), { target: { value: 'camp' } })
    expect(screen.getByLabelText('Município')).toHaveValue('71072')
    expect(within(screen.getByLabelText('Município')).getByRole('option', { name: 'São Paulo' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar município'), { target: { value: 'inexistente' } })
    expect(screen.getByText(/Nenhuma opção encontrada/)).toHaveTextContent('A seleção atual foi mantida.')
  })

  it('clears the municipality search on state changes', () => {
    const props = { metadata, onSelect: vi.fn() }
    const { rerender } = render(<MunicipalityNavigation {...props} selection={{ scope: 'domestic', state: 'sp' }} />)
    fireEvent.change(screen.getByLabelText('Buscar município'), { target: { value: 'camp' } })
    rerender(<MunicipalityNavigation {...props} selection={{ scope: 'domestic', state: 'rj' }} />)
    expect(screen.getByLabelText('Buscar município')).toHaveValue('')
    expect(within(screen.getByLabelText('Município')).getByRole('option', { name: 'Rio de Janeiro' })).toBeInTheDocument()
  })

  it('offers all scopes and marks current scope and breadcrumb', () => {
    const onSelect = vi.fn()
    render(<Harness initial={{ scope: 'domestic', state: 'sp', municipality: '62910' }} onSelect={onSelect} />)
    const scopes = screen.getByRole('navigation', { name: 'Abrangência dos resultados' })
    const breadcrumbs = screen.getByRole('navigation', { name: 'Localidade atual' })
    expect(within(scopes).getByRole('button', { name: 'Brasil' })).toHaveAttribute('aria-current', 'true')
    expect(within(breadcrumbs).getByText('Campinas')).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(breadcrumbs).getByRole('button', { name: 'São Paulo' }))
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'domestic', state: 'sp' })
    fireEvent.click(within(breadcrumbs).getByRole('button', { name: 'Brasil' }))
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'domestic' })
    fireEvent.click(within(scopes).getByRole('button', { name: 'Exterior' }))
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'overseas' })
    fireEvent.click(within(scopes).getByRole('button', { name: 'Total geral' }))
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'overall' })
    expect(within(breadcrumbs).getByText('Total geral')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(within(scopes).getByRole('button', { name: 'Brasil' }))
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'domestic' })
  })

  it('shows the selected country in the breadcrumb with an exterior parent', () => {
    const onSelect = vi.fn()
    render(<Harness initial={{ scope: 'overseas', country: '990' }} onSelect={onSelect} />)
    const breadcrumbs = screen.getByRole('navigation', { name: 'Localidade atual' })
    expect(within(breadcrumbs).getByText('Portugal')).toHaveAttribute('aria-current', 'page')
    fireEvent.click(within(breadcrumbs).getByRole('button', { name: 'Exterior' }))
    expect(onSelect).toHaveBeenLastCalledWith({ scope: 'overseas' })
  })
})
