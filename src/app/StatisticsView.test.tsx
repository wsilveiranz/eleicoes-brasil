import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetManifest, DatasetSummary } from '../domain/comparison'
import { regions } from '../domain/regions'
import { regionalVotes } from '../domain/statistics'
import { loadAgeData, loadParticipation, type AgeData, type ParticipationData } from '../data/statistics'
import { StatisticsView } from './StatisticsView'

vi.mock('../data/statistics', async (original) => ({
  ...await original<typeof import('../data/statistics')>(),
  loadAgeData: vi.fn(), loadParticipation: vi.fn(),
}))
const manifest: DatasetManifest = JSON.parse(readFileSync('public/data/2026/manifest.json', 'utf8'))
const summary: DatasetSummary = JSON.parse(readFileSync(`public/data/2026/${manifest.summary.path}`, 'utf8'))
const participation: ParticipationData = JSON.parse(readFileSync('public/data/2026/participation.json', 'utf8'))
function ageData(): AgeData {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1, year: 2026, checkedAt: now, lastSuccessAt: now, dataUpdatedAt: now,
    refresh: 'ok', error: null, sha256: 'a'.repeat(64), etag: null, lastModified: null,
    source: 'https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_comparecimento_abstencao/perfil_comparecimento_abstencao_2026.zip',
    first: {
      status: 'available', sourceGeneratedAt: '2026-10-13T19:46:32Z',
      states: [...regions.flatMap(({ states }) => [...states]), 'zz'].map((code) => code.toUpperCase()),
      bands: [{ code: '1617', label: '16 a 17 anos', eligible: 100, attended: 80, abstained: 20 }],
    },
    second: { status: 'not-published', sourceGeneratedAt: null, states: [], bands: [] },
  }
}
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><StatisticsView summary={summary} /></QueryClientProvider>)
}
beforeEach(() => {
  vi.mocked(loadParticipation).mockResolvedValue(participation)
  vi.mocked(loadAgeData).mockResolvedValue(ageData())
})

describe('participation and electoral profile', () => {
  it('shows two-round national and regional turnout with source denominators and no invented missing votes', async () => {
    show()
    const national = await screen.findByRole('region', { name: 'Participação total nos dois turnos' })
    expect(within(national).getAllByRole('img')).toHaveLength(2)
    expect(within(national).getAllByText(/158.745.502 eleitores aptos/)).toHaveLength(2)
    expect(within(national).getByText(/125.275.835/)).toHaveTextContent('78,92%')
    expect(within(national).getAllByText(/423/)).toHaveLength(2)
    const regional = screen.getByRole('region', { name: 'Participação por região brasileira' })
    expect(within(regional).getAllByRole('img')).toHaveLength(10)
    for (const region of regions) expect(within(regional).getByRole('region', { name: `Participação: ${region.name}` })).toBeVisible()
  })

  it('switches side-by-side regional candidate pies and their numeric table between rounds', async () => {
    show()
    const section = screen.getByRole('region', { name: 'Distribuição regional dos votos por candidato' })
    expect(within(section).getAllByRole('img')).toHaveLength(2)
    const table = within(section).getByRole('table')
    const count = regionalVotes(summary, 'second', summary.finalists[0]!.id)[0]!.value
    expect(table).toHaveTextContent(new Intl.NumberFormat('pt-BR').format(count))
    fireEvent.change(screen.getByLabelText('Turno da distribuição regional'), { target: { value: 'first' } })
    expect(table).toHaveAccessibleName(/1º turno/)
    expect(table).toHaveTextContent(new Intl.NumberFormat('pt-BR').format(
      regionalVotes(summary, 'first', summary.finalists[0]!.id)[0]!.value,
    ))
    await screen.findByRole('region', { name: 'Comparecimento por faixa etária' })
  })

  it('does not invent second-round age values and presents its official publication state', async () => {
    show()
    const section = await screen.findByRole('region', { name: 'Comparecimento por faixa etária' })
    expect(within(section).getByText(/2º turno: dados de comparecimento por idade ainda não publicados/)).toBeVisible()
    const row = within(section).getByRole('row', { name: /16 a 17 anos/ })
    expect(row).toHaveTextContent('80,00%')
    expect(row).toHaveTextContent('100,00%')
    for (const cell of [...row.children].slice(5)) expect(cell).toHaveTextContent(/^—$/)
    expect(within(section).getAllByRole('img')).toHaveLength(1)
    expect(within(section).getByText(/O voto é secreto/)).toBeVisible()
    expect(screen.getByText('Fontes, cobertura e metodologia das estatísticas').parentElement).not.toHaveAttribute('open')
  })

  it('enables age changes automatically when a complete second round arrives', async () => {
    const ages = ageData()
    ages.second = { ...structuredClone(ages.first), sourceGeneratedAt: '2026-10-26T00:00:00Z' }
    ages.second.bands[0]!.attended = 90
    ages.second.bands[0]!.abstained = 10
    vi.mocked(loadAgeData).mockResolvedValue(ages)
    show()
    const section = await screen.findByRole('region', { name: 'Comparecimento por faixa etária' })
    expect(within(section).queryByText(/ainda não publicados/)).not.toBeInTheDocument()
    expect(within(section).getAllByRole('img')).toHaveLength(2)
    const row = within(section).getByRole('row', { name: /16 a 17 anos/ })
    expect(row.children[9]).toHaveTextContent('+10')
    expect(row.children[10]).toHaveTextContent('+10,00 pp')
    expect(row.children[11]).toHaveTextContent('0,00 pp')
  })

  it('surfaces source refresh failure and stale checks while retaining last valid ages', async () => {
    const ages = ageData()
    ages.refresh = 'error'
    ages.error = 'Falha ao verificar a fonte TSE: HTTP 503'
    ages.lastSuccessAt = '2026-01-01T00:00:00Z'
    vi.mocked(loadAgeData).mockResolvedValue(ages)
    show()
    const section = await screen.findByRole('region', { name: 'Comparecimento por faixa etária' })
    expect(within(section).getByText(/HTTP 503/)).toBeVisible()
    expect(within(section).getByText(/Verificação atrasada/)).toBeVisible()
    expect(within(section).getByRole('row', { name: /16 a 17 anos/ })).toHaveTextContent('80')
  })

  it('reports loading failures instead of displaying successful zero turnout', async () => {
    vi.mocked(loadParticipation).mockRejectedValue(new Error('Participação indisponível'))
    vi.mocked(loadAgeData).mockRejectedValue(new Error('Perfil indisponível'))
    show()
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(screen.queryByRole('region', { name: 'Participação total nos dois turnos' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar carregar perfil etário novamente' })).toBeVisible()
  })
})
