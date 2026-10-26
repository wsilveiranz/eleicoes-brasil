import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComparisonRound, Finalist, RoundComparison } from '../domain/comparison'
import * as comparisonDomain from '../domain/comparison'
import type { ElectionMetadata } from '../domain/geography'
import { GeographyOverviewTable } from './GeographyOverviewTable'

const finalists: Finalist[] = [
  { id: '13', number: '13', name: 'Ana', party: 'PT' },
  { id: '22', number: '22', name: 'Beatriz', party: 'PL' },
]
const metadata: ElectionMetadata = {
  election: { id: '6258', cycle: 'ele2026', name: 'Presidente', date: '2026-10-25', year: 2026, round: '2' },
  states: [
    { code: 'sp', name: 'SÃO PAULO', municipalities: [] },
    { code: 'df', name: 'DISTRITO FEDERAL', municipalities: [] },
  ],
  countries: [
    { code: 'portugal', name: 'Portugal', municipalities: [] },
    { code: 'albania', name: 'Albânia', municipalities: [] },
  ],
  overseasMunicipalities: [],
}

function round(electionId: string, validVotes: number, ana: number, others = 0): ComparisonRound {
  return {
    electionId, validVotes, totalVotes: validVotes + 50, blankVotes: 20, nullVotes: 30,
    votes: { '13': ana, '22': validVotes - ana - others }, otherVotes: others,
    sections: { counted: 100, total: 100 }, countingComplete: true,
    sourceTimes: { oldest: '2026-10-25T21:00:00Z', latest: '2026-10-25T21:00:00Z' },
    coverage: { received: 1, expected: 1 },
  }
}

function comparison(id: string, first = round('6257', 1000, 400, 100), second = round('6258', 1200, 600)): RoundComparison {
  return {
    geography: { id, kind: id.startsWith('country:') ? 'country' : 'state', label: id },
    first, second,
  }
}

function show(
  scope: 'domestic' | 'overseas' = 'domestic',
  comparisons = [comparison('state:sp'), comparison('state:df')],
  inventory = metadata,
) {
  return render(
    <GeographyOverviewTable metadata={inventory} scope={scope} comparisons={comparisons} finalists={finalists} />,
  )
}

function chooseMetric(value: string) {
  fireEvent.change(screen.getByLabelText('Métrica de comparação'), { target: { value } })
}

function row(name: string) {
  return screen.getByRole('row', { name: new RegExp(name) })
}

function rowNames() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
    .map((item) => within(item).getByRole('link').textContent)
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('geographic round comparison table', () => {
  it('defaults to valid-vote totals and switches to each finalist without navigation', () => {
    show()
    const sp = row('SÃO PAULO')
    expect(screen.getByLabelText('Métrica de comparação')).toHaveValue('total')
    expect(within(sp).getByText('1.000')).toBeVisible()
    expect(within(sp).getByText('1.200')).toBeVisible()
    expect(within(sp).getByText('+200')).toBeVisible()
    expect(within(sp).getByText('+20,00%')).toBeVisible()
    expect(within(sp).getByText(/Fonte 1º turno/)).toBeVisible()
    expect(within(sp).getByText(/Fonte 2º turno/)).toBeVisible()
    expect(screen.queryByRole('columnheader', { name: /Apuração/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Outros' })).not.toBeInTheDocument()
    chooseMetric('13')
    expect(within(sp).getByText('400')).toBeVisible()
    expect(within(sp).getByText('600')).toBeVisible()
    expect(within(sp).getByText('40,00%')).toBeVisible()
    expect(within(sp).getByText('50,00%')).toBeVisible()
    expect(within(sp).getByText('+10,00 p.p.')).toBeVisible()
    expect(screen.getByText('13 · Ana · PT')).toBeVisible()
    chooseMetric('22')
    expect(within(sp).getByText('500')).toBeVisible()
    expect(within(sp).getByText('+100')).toBeVisible()
    expect(within(sp).getByText('0,00 p.p.')).toBeVisible()
    expect(window.location.search).toBe('')
  })

  it('uses round-specific denominators and displays signed negative or zero changes', () => {
    show('domestic', [
      comparison('state:sp', round('6257', 1000, 500), round('6258', 800, 300)),
      comparison('state:df', round('6257', 1000, 500), round('6258', 1000, 500)),
    ])
    expect(within(row('SÃO PAULO')).getByText('-200')).toBeVisible()
    expect(within(row('SÃO PAULO')).getByText('-20,00%')).toBeVisible()
    expect(within(row('DISTRITO FEDERAL')).getByText('0')).toBeVisible()
    chooseMetric('13')
    const sp = row('SÃO PAULO')
    expect(within(sp).getByText('50,00%')).toBeVisible()
    expect(within(sp).getByText('37,50%')).toBeVisible()
    expect(within(sp).getByText('-200')).toBeVisible()
    expect(within(sp).getByText('-12,50 p.p.')).toBeVisible()
    expect(within(row('DISTRITO FEDERAL')).getByText('0,00 p.p.')).toBeVisible()
  })

  it('keeps zero denominators unavailable but preserves actual zero counts and count changes', () => {
    show('domestic', [
      comparison('state:sp', round('6257', 0, 0), round('6258', 100, 0)),
      comparison('state:df', round('6257', 0, 0), round('6258', 0, 0)),
    ])
    expect(within(row('SÃO PAULO')).getByText('+100')).toBeVisible()
    expect(within(row('SÃO PAULO')).getByText('—')).toBeVisible()
    chooseMetric('13')
    expect(within(row('SÃO PAULO')).getByText('0,00%')).toBeVisible()
    expect(within(row('SÃO PAULO')).getAllByText('—')).toHaveLength(2)
    expect(within(row('DISTRITO FEDERAL')).getAllByText('—')).toHaveLength(3)
    expect(within(row('DISTRITO FEDERAL')).getAllByText('0')).toHaveLength(3)
  })

  it('does not display signed zero when a small change rounds to zero', () => {
    show('domestic', [
      comparison('state:sp', round('6257', 100000, 50000), round('6258', 99999, 49999)),
      comparison('state:df', round('6257', 100000, 50000), round('6258', 100001, 50001)),
    ])
    expect(within(row('SÃO PAULO')).getByText('-1')).toBeVisible()
    expect(within(row('DISTRITO FEDERAL')).getByText('+1')).toBeVisible()
    expect(within(row('SÃO PAULO')).getByText('0,00%')).toBeVisible()
    expect(within(row('DISTRITO FEDERAL')).getByText('0,00%')).toBeVisible()
    chooseMetric('13')
    expect(within(row('SÃO PAULO')).getByText('0,00 p.p.')).toBeVisible()
    expect(within(row('DISTRITO FEDERAL')).getByText('0,00 p.p.')).toBeVisible()
    expect(screen.queryByText(/[-+]0,00/)).not.toBeInTheDocument()
  })

  it('filters accent-insensitive names/codes and dropdowns only within the table', () => {
    const comparisons = [comparison('state:sp'), comparison('state:df')]
    const original = structuredClone(comparisons)
    show('domestic', comparisons)
    fireEvent.change(screen.getByLabelText('Buscar estado'), { target: { value: 'sao' } })
    expect(row('SÃO PAULO')).toBeVisible()
    expect(screen.queryByRole('row', { name: /DISTRITO FEDERAL/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2')
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'df' } })
    expect(screen.getByText(/Nenhuma localidade encontrada/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getAllByRole('row')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Buscar estado'), { target: { value: 'DF' } })
    expect(row('DISTRITO FEDERAL')).toBeVisible()
    expect(screen.queryByRole('row', { name: /SÃO PAULO/ })).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
    expect(comparisons).toEqual(original)
  })

  it('filters country accents/codes, clears empty matches, and navigates via the row link', () => {
    show('overseas', [comparison('country:portugal'), comparison('country:albania')])
    fireEvent.change(screen.getByLabelText('Buscar país de votação'), { target: { value: 'albania' } })
    expect(row('Albânia')).toBeVisible()
    fireEvent.change(screen.getByLabelText('País de votação'), { target: { value: 'portugal' } })
    expect(screen.getByText(/Nenhuma localidade encontrada/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    const link = within(row('Portugal')).getByRole('link')
    expect(link).toHaveAttribute('href', '?visao=exterior&pais=portugal')
    expect(window.location.search).toBe('')
    fireEvent.click(link)
    expect(window.location.search).toBe('?visao=exterior&pais=portugal')
  })

  it('retains native modified links and navigates on an unmodified state link', () => {
    show()
    const link = within(row('SÃO PAULO')).getByRole('link')
    expect(link).toHaveAttribute('href', '?visao=brasil&uf=sp')
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      const suppressNativeNavigation = (event: MouseEvent) => event.preventDefault()
      document.addEventListener('click', suppressNativeNavigation, { once: true })
      fireEvent.click(link, { [modifier]: true })
      expect(window.location.search).toBe('')
    }
    fireEvent.click(link)
    expect(window.location.search).toBe('?visao=brasil&uf=sp')
  })

  it('sorts numeric columns in both directions and shares/pp with semantic keyboard-focusable buttons', () => {
    show('domestic', [
      comparison('state:sp', round('6257', 2000, 100), round('6258', 1000, 900)),
      comparison('state:df', round('6257', 1000, 500), round('6258', 2000, 100)),
    ])
    const sortBy = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    sortBy('1º turno · votos')
    expect(screen.getByRole('columnheader', { name: '1º turno · votos' })).toHaveAttribute('aria-sort', 'ascending')
    sortBy('1º turno · votos')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    expect(screen.getByRole('columnheader', { name: '1º turno · votos' })).toHaveAttribute('aria-sort', 'descending')
    sortBy('2º turno · votos')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    sortBy('Variação de votos')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    sortBy('Variação relativa')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    chooseMetric('13')
    sortBy('1º turno · % dos válidos')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    sortBy('2º turno · % dos válidos')
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    sortBy('Variação em p.p.')
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    const nameButton = screen.getByRole('button', { name: 'Estado / DF' })
    nameButton.focus()
    expect(nameButton).toHaveFocus()
    expect(nameButton).toHaveAttribute('type', 'button')
    fireEvent.click(nameButton, { detail: 0 })
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    sortBy('Estado / DF')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    expect(window.location.search).toBe('')
  })

  it('uses stable name tie-breaks, sorts unavailable values last and resets hidden share sorting', () => {
    const inventory = {
      ...metadata,
      states: [...metadata.states, { code: 'ac', name: 'ACRE', municipalities: [] }],
    }
    show('domestic', [comparison('state:sp'), comparison('state:df')], inventory)
    fireEvent.click(screen.getByRole('button', { name: 'Variação de votos' }))
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO', 'ACRE'])
    fireEvent.click(screen.getByRole('button', { name: 'Variação de votos' }))
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO', 'ACRE'])
    chooseMetric('13')
    fireEvent.click(screen.getByRole('button', { name: '1º turno · % dos válidos' }))
    chooseMetric('total')
    expect(screen.getByRole('columnheader', { name: 'Estado / DF' })).toHaveAttribute('aria-sort', 'ascending')
    expect(rowNames()).toEqual(['ACRE', 'DISTRITO FEDERAL', 'SÃO PAULO'])
  })

  it('keeps absent or incomplete pairs explicitly unavailable without false zeros or deltas', () => {
    const broken = { ...comparison('state:sp'), second: undefined } as unknown as RoundComparison
    show('domestic', [broken])
    for (const name of ['SÃO PAULO', 'DISTRITO FEDERAL']) {
      expect(row(name)).toHaveTextContent('Comparação indisponível')
      expect(within(row(name)).getAllByText('—')).toHaveLength(4)
      expect(within(row(name)).queryByText('0')).not.toBeInTheDocument()
    }
    chooseMetric('13')
    expect(within(row('SÃO PAULO')).getAllByText('—')).toHaveLength(6)
  })

  it('keeps a genuinely missing candidate unavailable rather than inventing its counts', () => {
    const missingCandidate = comparison('state:sp')
    const view = show('domestic', [missingCandidate, comparison('state:df')])
    chooseMetric('13')
    delete missingCandidate.second.votes['13']
    missingCandidate.second.otherVotes = 600
    view.rerender(
      <GeographyOverviewTable
        metadata={metadata}
        scope="domestic"
        comparisons={[missingCandidate, comparison('state:df')]}
        finalists={finalists}
      />,
    )
    expect(row('SÃO PAULO')).toHaveTextContent('Comparação indisponível')
    expect(within(row('SÃO PAULO')).getAllByText('—')).toHaveLength(6)
    expect(within(row('SÃO PAULO')).queryByText('0')).not.toBeInTheDocument()
    expect(row('DISTRITO FEDERAL')).not.toHaveTextContent('Comparação indisponível')
  })

  it('propagates unexpected calculation failures rather than hiding them as unavailable data', () => {
    const failure = new Error('Unexpected calculation failure')
    vi.spyOn(comparisonDomain, 'validVoteComparison').mockImplementation(() => { throw failure })
    expect(() => show()).toThrow(failure)
  })

  it.each([['domestic', 27], ['overseas', 133]] as const)(
    'renders the complete %s inventory of %i rows with no mount or interaction network requests',
    (scope, count) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
      const locations = Array.from({ length: count }, (_, index) => ({
        code: `code${index}`, name: `Local ${index}`, municipalities: [],
      }))
      const inventory = { ...metadata, [scope === 'domestic' ? 'states' : 'countries']: locations }
      const comparisons = locations.map(({ code }) => comparison(`${scope === 'domestic' ? 'state' : 'country'}:${code}`))
      const originalOrder = comparisons.map(({ geography }) => geography.id)
      show(scope, comparisons, inventory)
      expect(screen.getAllByRole('row')).toHaveLength(count + 1)
      expect(screen.getByRole('status')).toHaveTextContent(`${count} de ${count}`)
      chooseMetric('22')
      fireEvent.click(screen.getByRole('button', { name: 'Variação de votos' }))
      expect(fetch).not.toHaveBeenCalled()
      expect(comparisons.map(({ geography }) => geography.id)).toEqual(originalOrder)
      expect(screen.getByRole('table').parentElement).toHaveAttribute('tabindex', '0')
    },
  )
})
