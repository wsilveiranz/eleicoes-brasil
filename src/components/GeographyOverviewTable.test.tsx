import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSelectionResult } from '../data/results'
import type { ElectionMetadata } from '../domain/geography'
import type { ResultSnapshot } from '../domain/results'
import { GeographyOverviewTable } from './GeographyOverviewTable'
import { createAppQueryClient } from '../app/queryClient'

vi.mock('../data/results', () => ({ loadSelectionResult: vi.fn() }))
const load = vi.mocked(loadSelectionResult)
const clients: QueryClient[] = []

const metadata: ElectionMetadata = {
  election: { id: '6258', cycle: 'ele2026', name: 'Presidente', date: '2026-10-25', year: 2026, round: '2' },
  states: [
    { code: 'sp', name: 'SÃO PAULO', municipalities: [] },
    { code: 'df', name: 'DISTRITO FEDERAL', municipalities: [] },
  ],
  countries: [
    { code: 'portugal', name: 'Portugal', municipalities: [{ code: '29955', name: 'Lisboa' }] },
    { code: 'albania', name: 'Albânia', municipalities: [{ code: '99139', name: 'Tirana' }] },
  ],
  overseasMunicipalities: [{ code: '29955', name: 'Lisboa' }, { code: '99139', name: 'Tirana' }],
}

function snapshot(id: string): ResultSnapshot {
  return {
    electionId: '6258',
    geography: { id, kind: 'state', label: id },
    candidates: [
      { id: 'b', number: '22', name: 'Beatriz', party: 'PB', votes: 1200, elected: false },
      { id: 'a', number: '13', name: 'Ana', party: 'PA', votes: 800, elected: false },
    ],
    validVotes: 2000, totalVotes: 2500, blankVotes: 200, nullVotes: 300,
    sections: { counted: 75, total: 100 }, countingComplete: false,
    sourceTimes: { oldest: '2026-10-25T21:00:00Z', latest: '2026-10-25T21:00:00Z' },
    fetchedAt: '2026-10-25T21:01:00Z',
    coverage: { received: 1, expected: 1 },
  }
}

function show(scope: 'domestic' | 'overseas', result = snapshot('overview')) {
  const client = new QueryClient()
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <GeographyOverviewTable metadata={metadata} scope={scope} snapshot={result} />
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.resetAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('geographic overview table', () => {
  it('filters state rows by accent-insensitive name/code and selection without navigating', () => {
    const summary = {
      ...snapshot('domestic'),
      constituents: [snapshot('state:sp'), snapshot('state:df')],
    }
    show('domestic', summary)
    fireEvent.change(screen.getByLabelText('Buscar estado'), { target: { value: 'sao' } })
    expect(screen.getByRole('row', { name: /SÃO PAULO/ })).toBeVisible()
    expect(screen.queryByRole('row', { name: /DISTRITO FEDERAL/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 de 2')
    expect(window.location.search).toBe('')
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'df' } })
    expect(screen.getByText(/Nenhuma localidade encontrada/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getAllByRole('row')).toHaveLength(3)
    fireEvent.change(screen.getByLabelText('Buscar estado'), { target: { value: 'df' } })
    expect(screen.getByRole('row', { name: /DISTRITO FEDERAL/ })).toBeVisible()
    expect(screen.queryByRole('row', { name: /SÃO PAULO/ })).not.toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })

  it('filters country rows without restarting or cancelling their shared queries', async () => {
    load.mockResolvedValue(snapshot('country'))
    show('overseas')
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    const firstSignal = load.mock.calls[0]?.[2]
    fireEvent.change(screen.getByLabelText('País de votação'), { target: { value: 'portugal' } })
    expect(screen.getByRole('row', { name: /Portugal/ })).toBeVisible()
    expect(screen.queryByRole('row', { name: /Albânia/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar país de votação'), { target: { value: 'inexistente' } })
    expect(screen.getByText(/Nenhuma localidade encontrada/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(screen.getByRole('row', { name: /Albânia/ })).toBeVisible()
    expect(load).toHaveBeenCalledTimes(2)
    expect(firstSignal?.aborted).toBe(false)
    expect(window.location.search).toBe('')
  })

  it('reuses domestic results and calculates each candidate share within its own state', () => {
    const summary = snapshot('domestic')
    summary.validVotes = 4000
    summary.constituents = [snapshot('state:sp'), snapshot('state:df')]
    summary.constituents[0]!.candidates.reverse()
    show('domestic', summary)
    const row = screen.getByRole('row', { name: /SÃO PAULO/ })
    expect(within(row).getByText('75,00%')).toBeInTheDocument()
    expect(within(row).getByText('75 de 100 seções')).toBeInTheDocument()
    expect(within(row).getByText('1.200 votos')).toBeInTheDocument()
    expect(within(row).getByText('60,00% dos válidos')).toBeInTheDocument()
    expect(within(row).getByText('40,00% dos válidos')).toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    fireEvent.click(within(row).getByRole('link'))
    expect(window.location.search).toBe('?visao=brasil&uf=sp')
  })

  it('keeps zero denominators unavailable and missing states explicit rather than showing zero', () => {
    const zero = snapshot('state:sp')
    zero.validVotes = 0
    zero.candidates = zero.candidates.map((candidate) => ({ ...candidate, votes: 0 }))
    zero.sections = { counted: 0, total: 0 }
    show('domestic', { ...snapshot('domestic'), constituents: [zero] })
    const sp = screen.getByRole('row', { name: /SÃO PAULO/ })
    expect(within(sp).getAllByText('0 votos')).toHaveLength(2)
    expect(within(sp).getAllByText('— dos válidos')).toHaveLength(2)
    const df = screen.getByRole('row', { name: /DISTRITO FEDERAL/ })
    expect(df).toHaveTextContent('Indisponível')
    expect(within(df).queryByText('0 votos')).not.toBeInTheDocument()
  })

  it('loads every country independently and isolates failures', async () => {
    load.mockImplementation(async (_, selection) => {
      if (selection.scope === 'overseas' && selection.country === 'portugal') {
        return snapshot('country:portugal')
      }
      throw new Error('Arquivo ainda não publicado')
    })
    show('overseas')
    const portugal = screen.getByRole('row', { name: /Portugal/ })
    expect(portugal).toHaveTextContent('Consultando')
    await waitFor(() => expect(portugal).toHaveTextContent('1.200 votos'))
    const albania = screen.getByRole('row', { name: /Albânia/ })
    await waitFor(() => expect(albania).toHaveTextContent('Indisponível'))
    expect(albania).toHaveTextContent('Arquivo ainda não publicado')
    expect(within(albania).queryByText('0 votos')).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
    fireEvent.click(within(portugal).getByRole('link'))
    expect(window.location.search).toBe('?visao=exterior&pais=portugal')
  })

  it('shares country queries with drill-downs and preserves last-good row data on refresh failure', async () => {
    load.mockResolvedValue(snapshot('country:portugal'))
    const client = show('overseas')
    const portugal = screen.getByRole('row', { name: /Portugal/ })
    await waitFor(() => expect(portugal).toHaveTextContent('1.200 votos'))
    expect(client.getQueryData(['results', '6258', 'country:portugal'])).toBeDefined()
    load.mockRejectedValue(new Error('Fonte indisponível'))
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['results', '6258', 'country:portugal'] })
    })
    await waitFor(() => expect(portugal).toHaveTextContent('Dados desatualizados'))
    expect(portugal).toHaveTextContent('1.200 votos')
    expect(portugal).toHaveTextContent('60,00% dos válidos')
  })

  it('mounts more than 100 country queries without cache eviction causing request storms', async () => {
    const client = createAppQueryClient()
    clients.push(client)
    const manyCountries = {
      ...metadata,
      countries: Array.from({ length: 133 }, (_, index) => ({
        code: `country${index}`, name: `Country ${index}`, municipalities: [],
      })),
    }
    load.mockRejectedValue(new Error('Arquivo indisponível'))
    render(
      <QueryClientProvider client={client}>
        <GeographyOverviewTable metadata={manyCountries} scope="overseas" snapshot={snapshot('overseas')} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getAllByText(/Indisponível/)).toHaveLength(133))
    expect(load).toHaveBeenCalledTimes(133)
  })
})
