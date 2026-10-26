import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { loadComparison, type LoadedDataset } from '../data/comparison'
import type { ComparisonRound, RoundComparison } from '../domain/comparison'
import type { ElectionMetadata } from '../domain/geography'
import { ResultView } from './ResultView'

vi.mock('../data/comparison', () => ({ loadComparison: vi.fn() }))
vi.mock('../components', () => ({
  ResultsPanel: ({ comparison }: { comparison: RoundComparison }) =>
    <div data-testid="comparison">{comparison.geography.id}</div>,
}))
vi.mock('../components/GeographyOverviewTable', () => ({
  GeographyOverviewTable: () => <div data-testid="overview">Geographic comparisons</div>,
}))

const secondElection: ElectionMetadata['election'] = {
  id: '6258', cycle: 'ele2026', name: 'Segundo turno', date: '2026-10-25', year: 2026, round: '2',
}
const resource = { path: 'capture/data.json', sha256: 'a'.repeat(64), bytes: 1 }
const dataset: LoadedDataset = {
  manifest: {
    schemaVersion: 1, version: 'capture', generatedAt: '2026-10-26T06:00:00Z',
    summary: resource, municipalities: { sp: resource }, provenance: resource,
  },
  summary: {
    schemaVersion: 1, version: 'capture', generatedAt: '2026-10-26T06:00:00Z',
    metadata: {
      election: secondElection,
      states: [{ code: 'sp', name: 'São Paulo', municipalities: [{ code: '71072', name: 'São Paulo' }] }],
      countries: [], overseasMunicipalities: [],
    },
    elections: { first: { ...secondElection, id: '6257', date: '2026-10-04', round: '1' }, second: secondElection },
    finalists: [], comparisons: [],
  },
}
const counts: ComparisonRound = {
  electionId: '6258', validVotes: 100, totalVotes: 100, blankVotes: 0, nullVotes: 0,
  votes: { a: 40, b: 60 }, otherVotes: 0, sections: { total: 1, counted: 1 },
  countingComplete: true, sourceTimes: { oldest: '2026-10-25T23:00:00Z', latest: '2026-10-25T23:00:00Z' },
  coverage: { received: 1, expected: 1 },
}
const overall: RoundComparison = {
  geography: { id: 'overall', kind: 'overall', label: 'Total geral' },
  first: { ...counts, electionId: '6257' }, second: counts,
}

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, wrapper: ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('static analytical application integration', () => {
  it('keys comparisons by dataset generation and never offers live polling controls', async () => {
    vi.mocked(loadComparison).mockResolvedValue(overall)
    const { client, wrapper } = harness()
    render(<ResultView dataset={dataset} selection={{ scope: 'overall' }} />, { wrapper })
    expect(await screen.findByTestId('comparison')).toHaveTextContent('overall')
    expect(client.getQueryData(['comparison', 'capture', 'overall'])).toEqual(overall)
    expect(screen.getByText(/Resultados finais dos dois turnos/)).toHaveTextContent('capture')
    expect(screen.queryByRole('button', { name: /Atualizar agora/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/30 segundos/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('overview')).not.toBeInTheDocument()
  })

  it('does not reuse a parent result while a municipality fails to load', async () => {
    const state: RoundComparison = {
      ...overall, geography: { id: 'state:sp', kind: 'state', label: 'São Paulo' },
    }
    let rejectCity: (error: Error) => void = () => { throw new Error('City request has not started') }
    vi.mocked(loadComparison).mockResolvedValueOnce(state).mockImplementationOnce(
      () => new Promise<RoundComparison>((_resolve, reject) => { rejectCity = reject }),
    )
    const { wrapper } = harness()
    const { rerender } = render(
      <ResultView dataset={dataset} selection={{ scope: 'domestic', state: 'sp' }} />, { wrapper },
    )
    expect(await screen.findByTestId('comparison')).toHaveTextContent('state:sp')
    rerender(<ResultView dataset={dataset} selection={{ scope: 'domestic', state: 'sp', municipality: '71072' }} />)
    expect(screen.queryByTestId('comparison')).not.toBeInTheDocument()
    await waitFor(() => expect(loadComparison).toHaveBeenCalledTimes(2))
    await act(async () => { rejectCity(new Error('Arquivo municipal indisponível')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Arquivo municipal indisponível')
    expect(screen.queryByTestId('comparison')).not.toBeInTheDocument()
  })

  it('supports an explicit retry after an unavailable static resource', async () => {
    vi.mocked(loadComparison).mockRejectedValueOnce(new Error('Falha de integridade')).mockResolvedValueOnce(overall)
    const { wrapper } = harness()
    render(<ResultView dataset={dataset} selection={{ scope: 'overall' }} />, { wrapper })
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de integridade')
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByTestId('comparison')).toHaveTextContent('overall')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
