import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComparisonRound, Finalist, RoundComparison } from '../domain/comparison'
import * as comparisonDomain from '../domain/comparison'
import type { ElectionMetadata } from '../domain/geography'
import { GeographyOverviewTable } from './GeographyOverviewTable'

const finalists: Finalist[] = [
  { id: '13', number: '13', name: 'Lula', party: 'PT' },
  { id: '22', number: '22', name: 'Flávio Bolsonaro', party: 'PL' },
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

function round(electionId: string, validVotes: number, lula: number, others = 0): ComparisonRound {
  return {
    electionId, validVotes, totalVotes: validVotes + 50, blankVotes: 20, nullVotes: 30,
    votes: { '13': lula, '22': validVotes - lula - others }, otherVotes: others,
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
  candidates = finalists,
) {
  return render(
    <GeographyOverviewTable metadata={inventory} scope={scope} comparisons={comparisons} finalists={candidates} />,
  )
}

function chooseSortMetric(value: string) {
  fireEvent.change(screen.getByLabelText('Ordenar valores de'), { target: { value } })
}

function group(name: string) {
  return screen.getByRole('rowgroup', { name: `Comparação: ${name}` })
}

function totalRow(name: string) {
  return within(group(name)).getAllByRole('row')[0]!
}

function candidateRow(name: string, candidate: string) {
  return within(group(name)).getByRole('row', { name: new RegExp(candidate) })
}

function rowNames() {
  return within(screen.getByRole('table')).getAllByRole('link').map((item) => item.textContent)
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('geographic round comparison table', () => {
  it('keeps total valid votes first, followed by both finalists and first-round Others', () => {
    show('domestic', undefined, undefined, [...finalists].reverse())
    const rows = within(group('SÃO PAULO')).getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('Total de votos válidos')
    expect(rows[1]).toHaveTextContent('13 · Lula · PT')
    expect(rows[2]).toHaveTextContent('22 · Flávio Bolsonaro · PL')
    expect(rows[3]).toHaveTextContent('Outros')
    expect(within(rows[3]!).getByText('100')).toBeVisible()
    expect(within(rows[3]!).getByText('10,00% dos válidos')).toBeVisible()
    for (const cell of [...rows[3]!.children].slice(2)) expect(cell).toHaveTextContent(/^—$/)
    expect(within(rows[0]!).getByText('1.000')).toBeVisible()
    expect(within(rows[0]!).getByText('1.200')).toBeVisible()
    expect(within(rows[0]!).getByText('+200')).toBeVisible()
    expect(within(rows[0]!).getByText('+20,00%')).toBeVisible()
    expect(within(rows[1]!).getByText('400')).toBeVisible()
    expect(within(rows[1]!).getByText('600')).toBeVisible()
    expect(within(rows[1]!).getByText('40,00% dos válidos')).toBeVisible()
    expect(within(rows[1]!).getByText('50,00% dos válidos')).toBeVisible()
    expect(within(rows[1]!).getByText('+10,00 p.p.')).toBeVisible()
    expect(within(rows[2]!).getByText('500')).toBeVisible()
    expect(within(rows[2]!).getByText('+100')).toBeVisible()
    expect(within(rows[2]!).getByText('0,00 p.p.')).toBeVisible()
    expect(screen.queryByLabelText('Métrica de comparação')).not.toBeInTheDocument()
    expect(screen.queryByText(/Fonte 1º turno/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Fonte 2º turno/)).not.toBeInTheDocument()
    expect(screen.getByText(/fontes de cada turno estão disponíveis no detalhamento/)).toBeVisible()
  })

  it('uses round-specific denominators and displays negative or zero changes on the correct lines', () => {
    show('domestic', [
      comparison('state:sp', round('6257', 1000, 500), round('6258', 800, 300)),
      comparison('state:df', round('6257', 1000, 500), round('6258', 1000, 500)),
    ])
    expect(within(totalRow('SÃO PAULO')).getByText('-200')).toBeVisible()
    expect(within(totalRow('SÃO PAULO')).getByText('-20,00%')).toBeVisible()
    expect(within(totalRow('DISTRITO FEDERAL')).getByText('0')).toBeVisible()
    const lula = candidateRow('SÃO PAULO', 'Lula')
    expect(within(lula).getByText('50,00% dos válidos')).toBeVisible()
    expect(within(lula).getByText('37,50% dos válidos')).toBeVisible()
    expect(within(lula).getByText('-200')).toBeVisible()
    expect(within(lula).getByText('-12,50 p.p.')).toBeVisible()
    expect(within(candidateRow('DISTRITO FEDERAL', 'Lula')).getByText('0,00 p.p.')).toBeVisible()
  })

  it('keeps zero denominators unavailable without replacing actual zero counts', () => {
    show('domestic', [
      comparison('state:sp', round('6257', 0, 0), round('6258', 100, 0)),
      comparison('state:df', round('6257', 0, 0), round('6258', 0, 0)),
    ])
    expect(within(totalRow('SÃO PAULO')).getByText('+100')).toBeVisible()
    expect(within(totalRow('SÃO PAULO')).getByText('—')).toBeVisible()
    expect(within(candidateRow('SÃO PAULO', 'Lula')).getByText('0,00% dos válidos')).toBeVisible()
    expect(within(candidateRow('SÃO PAULO', 'Lula')).getAllByText('—')).toHaveLength(2)
    expect(within(candidateRow('DISTRITO FEDERAL', 'Lula')).getAllByText('—')).toHaveLength(3)
    expect(within(candidateRow('DISTRITO FEDERAL', 'Lula')).getAllByText('0')).toHaveLength(3)
    const others = candidateRow('DISTRITO FEDERAL', 'Outros')
    expect(others.children[1]).toHaveTextContent('0')
    expect(within(others).getAllByText('—')).toHaveLength(4)
  })

  it('does not display signed zero when a small change rounds to zero', () => {
    show('domestic', [
      comparison('state:sp', round('6257', 100000, 50000), round('6258', 99999, 49999)),
      comparison('state:df', round('6257', 100000, 50000), round('6258', 100001, 50001)),
    ])
    expect(within(totalRow('SÃO PAULO')).getByText('-1')).toBeVisible()
    expect(within(totalRow('DISTRITO FEDERAL')).getByText('+1')).toBeVisible()
    expect(within(totalRow('SÃO PAULO')).getByText('0,00%')).toBeVisible()
    expect(within(totalRow('DISTRITO FEDERAL')).getByText('0,00%')).toBeVisible()
    expect(within(candidateRow('SÃO PAULO', 'Lula')).getByText('0,00 p.p.')).toBeVisible()
    expect(within(candidateRow('DISTRITO FEDERAL', 'Lula')).getByText('0,00 p.p.')).toBeVisible()
    expect(screen.queryByText(/[-+]0,00/)).not.toBeInTheDocument()
  })

  it('filters whole locality groups by accent-insensitive names/codes and dropdowns', () => {
    const comparisons = [comparison('state:sp'), comparison('state:df')]
    const original = structuredClone(comparisons)
    show('domestic', comparisons)
    fireEvent.change(screen.getByLabelText('Buscar estado'), { target: { value: 'sao' } })
    expect(within(group('SÃO PAULO')).getAllByRole('row')).toHaveLength(4)
    expect(screen.queryByRole('rowgroup', { name: 'Comparação: DISTRITO FEDERAL' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2')
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'df' } })
    expect(screen.getByText(/Nenhuma localidade encontrada/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getAllByRole('row')).toHaveLength(9)
    fireEvent.change(screen.getByLabelText('Buscar estado'), { target: { value: 'DF' } })
    expect(group('DISTRITO FEDERAL')).toBeVisible()
    expect(screen.queryByRole('rowgroup', { name: 'Comparação: SÃO PAULO' })).not.toBeInTheDocument()
    expect(window.location.search).toBe('')
    expect(comparisons).toEqual(original)
  })

  it('filters countries and preserves row-name navigation', () => {
    show('overseas', [comparison('country:portugal'), comparison('country:albania')])
    fireEvent.change(screen.getByLabelText('Buscar país de votação'), { target: { value: 'albania' } })
    expect(group('Albânia')).toBeVisible()
    fireEvent.change(screen.getByLabelText('País de votação'), { target: { value: 'portugal' } })
    expect(screen.getByText(/Nenhuma localidade encontrada/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    const link = within(group('Portugal')).getByRole('link')
    expect(candidateRow('Portugal', 'Outros')).toHaveTextContent('10,00% dos válidos')
    expect(link).toHaveAttribute('href', '?visao=exterior&pais=portugal')
    fireEvent.click(link)
    expect(window.location.search).toBe('?visao=exterior&pais=portugal')
  })

  it('retains native modified links and unmodified state navigation', () => {
    show()
    const link = within(group('SÃO PAULO')).getByRole('link')
    expect(link).toHaveAttribute('href', '?visao=brasil&uf=sp')
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      document.addEventListener('click', (event) => event.preventDefault(), { once: true })
      fireEvent.click(link, { [modifier]: true })
      expect(window.location.search).toBe('')
    }
    fireEvent.click(link)
    expect(window.location.search).toBe('?visao=brasil&uf=sp')
  })

  it('omits countries with no ballots in both rounds from rows and options, retaining either-round votes and missing data', () => {
    const zero = { ...round('6257', 0, 0), totalVotes: 0, blankVotes: 0, nullVotes: 0 }
    const inventory = {
      ...metadata,
      countries: [
        ...metadata.countries,
        { code: 'firstonly', name: 'Primeiro turno', municipalities: [] },
        { code: 'secondonly', name: 'Segundo turno', municipalities: [] },
        { code: 'blankonly', name: 'Só brancos e nulos', municipalities: [] },
        { code: 'missing', name: 'Sem dados', municipalities: [] },
      ],
    }
    show('overseas', [
      comparison('country:portugal'),
      comparison('country:albania', zero, { ...zero, electionId: '6258' }),
      comparison('country:firstonly', round('6257', 100, 50), { ...zero, electionId: '6258' }),
      comparison('country:secondonly', zero, round('6258', 100, 50)),
      comparison('country:blankonly', round('6257', 0, 0), round('6258', 0, 0)),
    ], inventory)
    expect(screen.queryByRole('rowgroup', { name: 'Comparação: Albânia' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Albânia' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('5 de 5 países de votação')
    for (const name of ['Portugal', 'Primeiro turno', 'Segundo turno', 'Só brancos e nulos', 'Sem dados']) {
      expect(group(name)).toBeVisible()
      expect(screen.getByRole('option', { name })).toBeInTheDocument()
    }
    expect(totalRow('Sem dados')).toHaveTextContent('Comparação indisponível')
    fireEvent.change(screen.getByLabelText('Buscar país de votação'), { target: { value: 'albania' } })
    expect(screen.getByText(/Nenhuma localidade encontrada/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.queryByRole('rowgroup', { name: 'Comparação: Albânia' })).not.toBeInTheDocument()
  })

  it('retains zero-vote domestic states and rejects malformed zero-ballot country data', () => {
    const zero = { ...round('6257', 0, 0), totalVotes: 0, blankVotes: 0, nullVotes: 0 }
    const { unmount } = show('domestic', [
      comparison('state:sp', zero, { ...zero, electionId: '6258' }),
    ])
    expect(group('SÃO PAULO')).toBeVisible()
    unmount()
    expect(() => show('overseas', [
      comparison('country:albania', { ...zero, validVotes: 1 }, { ...zero, electionId: '6258' }),
    ])).toThrow(/reconciliam/)
  })

  it('sorts whole locality groups using totals or a selected finalist without hiding any line', () => {
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
    sortBy('2º turno · votos')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    chooseSortMetric('13')
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    sortBy('Variação de votos')
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    sortBy('Variação relativa / p.p.')
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    chooseSortMetric('22')
    expect(within(group('SÃO PAULO')).getAllByRole('row')).toHaveLength(4)
    expect(candidateRow('SÃO PAULO', 'Lula')).toBeVisible()
    expect(candidateRow('SÃO PAULO', 'Flávio')).toBeVisible()
    const button = screen.getByRole('button', { name: 'Estado / DF' })
    button.focus()
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('type', 'button')
    fireEvent.click(button, { detail: 0 })
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO'])
    sortBy('Estado / DF')
    expect(rowNames()).toEqual(['SÃO PAULO', 'DISTRITO FEDERAL'])
    expect(window.location.search).toBe('')
  })

  it('uses stable name tie-breaks and sorts absent comparisons last', () => {
    const inventory = { ...metadata, states: [...metadata.states, { code: 'ac', name: 'ACRE', municipalities: [] }] }
    show('domestic', [comparison('state:sp'), comparison('state:df')], inventory)
    fireEvent.click(screen.getByRole('button', { name: 'Variação de votos' }))
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO', 'ACRE'])
    fireEvent.click(screen.getByRole('button', { name: 'Variação de votos' }))
    expect(rowNames()).toEqual(['DISTRITO FEDERAL', 'SÃO PAULO', 'ACRE'])
  })

  it('keeps all lines explicitly unavailable when a locality has no comparison', () => {
    show('domestic', [])
    for (const name of ['SÃO PAULO', 'DISTRITO FEDERAL']) {
      const rows = within(group(name)).getAllByRole('row')
      expect(rows).toHaveLength(4)
      for (const row of rows) {
        expect(row).toHaveTextContent('Comparação indisponível')
        expect(within(row).queryByText('0')).not.toBeInTheDocument()
      }
      expect(within(rows[0]!).getAllByText('—')).toHaveLength(4)
      expect(within(rows[1]!).getAllByText('—')).toHaveLength(6)
    }
  })

  it('propagates invalid or unexpected calculation failures instead of fabricating counts', () => {
    const invalid = comparison('state:sp')
    delete invalid.second.votes['13']
    expect(() => show('domestic', [invalid])).toThrow(/Identidade/)
    const failure = new Error('Unexpected calculation failure')
    vi.spyOn(comparisonDomain, 'validVoteComparison').mockImplementation(() => { throw failure })
    expect(() => show()).toThrow(failure)
  })

  it.each([['domestic', 27], ['overseas', 133]] as const)(
    'renders all four lines for every %s locality without network requests',
    (scope, count) => {
      const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'))
      const locations = Array.from({ length: count }, (_, index) => ({
        code: `code${index}`, name: `Local ${index}`, municipalities: [],
      }))
      const inventory = { ...metadata, [scope === 'domestic' ? 'states' : 'countries']: locations }
      const comparisons = locations.map(({ code }) => comparison(`${scope === 'domestic' ? 'state' : 'country'}:${code}`))
      const originalOrder = comparisons.map(({ geography }) => geography.id)
      show(scope, comparisons, inventory)
      expect(screen.getAllByRole('row')).toHaveLength(count * 4 + 1)
      expect(screen.getByRole('status')).toHaveTextContent(`${count} de ${count}`)
      chooseSortMetric('22')
      fireEvent.click(screen.getByRole('button', { name: 'Variação de votos' }))
      expect(fetch).not.toHaveBeenCalled()
      expect(comparisons.map(({ geography }) => geography.id)).toEqual(originalOrder)
      expect(screen.getByRole('table').parentElement).toHaveAttribute('tabindex', '0')
    },
  )
})
