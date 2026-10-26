import { readFileSync } from 'node:fs'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetManifest, DatasetSummary } from '../domain/comparison'
import { regions } from '../domain/regions'
import { regionalVotes } from '../domain/statistics'
import { loadAgeData, loadParticipation, type AgeData, type ParticipationData } from '../data/statistics'
import { StatisticsView } from './StatisticsView'
import { BlankNullBar, CompositionBar } from '../components/StatisticsCharts'

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
      bands: [{ code: '1600', label: '16 anos', eligible: 100, attended: 80, abstained: 20 }],
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
  it('compares blank/null counts and ballot shares nationally and across all five regions without claiming voter transfers', async () => {
    show()
    const section = screen.getByRole('region', { name: 'Votos brancos e nulos nos dois turnos' })
    expect(within(section).getAllByRole('img')).toHaveLength(12)
    expect(within(section).getAllByRole('row')).toHaveLength(19)
    const national = within(section).getByRole('rowgroup', { name: 'Total geral · Brasil e exterior' })
    const combined = within(national).getByRole('row', { name: /Brancos \+ nulos/ })
    expect(combined.children[1]).toHaveTextContent('5.975.047')
    expect(combined.children[2]).toHaveTextContent('4,77%')
    expect(combined.children[3]).toHaveTextContent('4.153.801')
    expect(combined.children[4]).toHaveTextContent('3,24%')
    expect(combined.children[5]).toHaveTextContent('−1.821.246')
    expect(combined.children[6]).toHaveTextContent('−1,53 pp')
    for (const region of regions) {
      expect(within(section).getByRole('region', { name: `Brancos e nulos: ${region.name}` })).toBeVisible()
    }
    expect(within(section).getByText(/Não prova que essas mesmas pessoas/)).toBeVisible()
    await screen.findByRole('region', { name: 'Comparecimento por faixa etária' })
  })

  it('keeps zero invalid ballots and zero ballot denominators explicit without NaN or fabricated percentages', () => {
    const { container } = render(<BlankNullBar title="1º turno" value={{ blankVotes: 0, nullVotes: 0, totalVotes: 0 }} maximum={0} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/Brancos, 0, —; Nulos, 0, —/)
    expect(container.querySelectorAll('[data-ballot]')).toHaveLength(0)
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('does not fabricate a 100% distribution when a composition has no attendees', () => {
    const { container } = render(<CompositionBar title="1º turno" unit="comparecimentos" segments={[
      { id: '16-17', label: '16 a 17 anos', value: 0, color: '#1b4965' },
    ]} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Sem comparecimentos: distribuição indisponível.')).toBeVisible()
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/)
  })

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

  it('shows both rounds together in aligned regional stacks and one comparison table without a selector', async () => {
    show()
    const section = screen.getByRole('region', { name: 'Distribuição regional dos votos por candidato' })
    expect(within(section).getAllByRole('img')).toHaveLength(4)
    expect(within(section).queryByRole('combobox')).not.toBeInTheDocument()
    const table = within(section).getByRole('table')
    expect(table).toHaveAccessibleName(/comparação dos turnos/)
    expect(within(table).getAllByRole('row')).toHaveLength(11)
    const count = regionalVotes(summary, 'second', summary.finalists[0]!.id)[0]!.value
    expect(table).toHaveTextContent(new Intl.NumberFormat('pt-BR').format(count))
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

  it('sums age counts before rates and shares, keeping unknown ages in the denominator and both chart and table', async () => {
    const ages = ageData()
    ages.first.bands.push(
      { code: '1700', label: '17 anos', eligible: 300, attended: 150, abstained: 150 },
      { code: '-3', label: 'Inválido', eligible: 10, attended: 2, abstained: 8 },
    )
    vi.mocked(loadAgeData).mockResolvedValue(ages)
    show()
    const section = await screen.findByRole('region', { name: 'Comparecimento por faixa etária' })
    const row = within(section).getByRole('row', { name: /16 a 17 anos/ })
    expect(row.children[1]).toHaveTextContent(/^400$/)
    expect(row.children[2]).toHaveTextContent(/^230$/)
    expect(row.children[3]).toHaveTextContent('57,50%')
    expect(row.children[4]).toHaveTextContent('99,14%')
    expect(within(section).getByRole('row', { name: /Idade desconhecida\/inválida/ }).children[2]).toHaveTextContent(/^2$/)
    expect(within(section).getByRole('img')).toHaveAccessibleName(/16 a 17 anos, 230.*Idade desconhecida\/inválida, 2/)
    expect(within(section).queryByRole('rowheader', { name: /^17 anos$/ })).not.toBeInTheDocument()
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
