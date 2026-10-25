import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ResultSnapshot } from '../domain/results'
import { ResultsPanel } from './ResultsPanel'

function snapshot(overrides: Partial<ResultSnapshot> = {}): ResultSnapshot {
  return {
    electionId: '6258',
    geography: { id: 'br', kind: 'overall', label: 'Total geral' },
    candidates: [
      { id: 'b', number: '22', name: 'Beatriz Souza', party: 'PB', votes: 1200, elected: false },
      { id: 'a', number: '13', name: 'Ana Silva', party: 'PA', votes: 800, elected: false },
    ],
    validVotes: 2000,
    totalVotes: 2500,
    blankVotes: 200,
    nullVotes: 300,
    sections: { counted: 75, total: 100 },
    countingComplete: false,
    sourceTimes: { oldest: '2026-10-25T21:00:00Z', latest: '2026-10-25T21:00:00Z' },
    fetchedAt: '2026-10-25T21:01:00Z',
    coverage: { received: 1, expected: 1 },
    ...overrides,
  }
}

function candidateRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1, -1)
}

describe('ResultsPanel', () => {
  it('shows pt-BR counts and candidate shares of valid votes in both presentations', () => {
    render(<ResultsPanel snapshot={snapshot()} />)
    const table = screen.getByRole('table')
    expect(within(table).getByText('1.200')).toBeInTheDocument()
    expect(within(table).getByText('800')).toBeInTheDocument()
    expect(screen.getAllByText('60,00%')).toHaveLength(2)
    expect(screen.getAllByText('40,00%')).toHaveLength(2)
    expect(screen.getByText('Percentuais sobre 2.000 votos válidos.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Seções apuradas' })).toHaveAttribute('value', '75')
    expect(screen.getByText('75,00%')).toBeInTheDocument()
    expect(screen.getByText('75').parentElement).toHaveTextContent('75 de 100 seções')
    expect(screen.getByText('Apuração em andamento')).toBeInTheDocument()
  })

  it('uses all ballots, not valid votes, for blank and null percentages', () => {
    render(<ResultsPanel snapshot={snapshot()} />)
    expect(screen.getByText('8,00% do total de votos').parentElement).toHaveTextContent('200')
    expect(screen.getByText('12,00% do total de votos').parentElement).toHaveTextContent('300')
    expect(screen.getByText('Total de votos').nextElementSibling).toHaveTextContent('2.500')
    expect(screen.getByText(/incluindo válidos, brancos e nulos/)).toBeInTheDocument()
  })

  it('distinguishes true zero counts from undefined shares at zero denominators', () => {
    const zero = snapshot({
      candidates: snapshot().candidates.map((candidate) => ({ ...candidate, votes: 0 })),
      validVotes: 0,
      totalVotes: 0,
      blankVotes: 0,
      nullVotes: 0,
      sections: { total: 0, counted: 0 },
    })
    render(<ResultsPanel snapshot={zero} />)
    const rows = candidateRows()
    for (const row of rows) {
      expect(within(row).getByText('0')).toBeInTheDocument()
      expect(within(row).getByText('—')).toBeInTheDocument()
    }
    expect(screen.queryByText('0,00%')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByText(/total de seções igual a zero/)).toBeInTheDocument()
    expect(screen.getByText(/Sem votos válidos/)).toBeInTheDocument()
    expect(screen.getByText(/Sem votos contabilizados/)).toBeInTheDocument()
  })

  it('shows a genuine zero percent when the denominator is nonzero', () => {
    const value = snapshot()
    value.candidates[1]!.votes = 0
    value.candidates[0]!.votes = 2000
    render(<ResultsPanel snapshot={value} />)
    expect(screen.getAllByText('0,00%')).toHaveLength(2)
    expect(screen.getAllByText('100,00%')).toHaveLength(3)
    const segments = screen.getByRole('img').querySelectorAll('.results-stack-segment')
    expect(segments[0]).toHaveStyle({ width: '0%' })
    expect(segments[1]).toHaveStyle({ width: '100%' })
  })

  it('has focusable native sorting buttons and announces direction on semantic column headers', () => {
    render(<ResultsPanel snapshot={snapshot()} />)
    expect(candidateRows()[0]).toHaveTextContent('Ana Silva')
    const numberHeader = screen.getByRole('columnheader', { name: /Número/ })
    expect(numberHeader).toHaveAttribute('aria-sort', 'ascending')
    const votesButton = screen.getByRole('button', { name: 'Votos' })
    expect(votesButton.tagName).toBe('BUTTON')
    expect(votesButton).toHaveAttribute('type', 'button')
    votesButton.focus()
    expect(votesButton).toHaveFocus()
    fireEvent.click(votesButton)
    const votesHeader = screen.getByRole('columnheader', { name: 'Votos' })
    expect(votesHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(numberHeader).toHaveAttribute('aria-sort', 'none')
    fireEvent.click(votesButton)
    expect(votesHeader).toHaveAttribute('aria-sort', 'descending')
    expect(votesButton).toHaveFocus()
    expect(candidateRows()[0]).toHaveTextContent('Beatriz Souza')
    fireEvent.click(screen.getByRole('button', { name: 'Nome' }))
    expect(candidateRows()[0]).toHaveTextContent('Ana Silva')
    fireEvent.click(screen.getByRole('button', { name: 'Partido' }))
    expect(screen.getByRole('columnheader', { name: 'Partido' })).toHaveAttribute('aria-sort', 'ascending')
    fireEvent.click(screen.getByRole('button', { name: '% dos válidos' }))
    expect(screen.getByRole('columnheader', { name: '% dos válidos' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('region', { name: 'Tabela de votos por candidatura' })).toHaveAttribute('tabindex', '0')
  })

  it('keeps comparison order and colors stable across source reordering, vote changes and table sorts', () => {
    const value = snapshot()
    const { rerender } = render(<ResultsPanel snapshot={value} />)
    const list = screen.getByRole('list')
    const initialItems = within(list).getAllByRole('listitem')
    expect(initialItems[0]).toHaveTextContent('Ana Silva')
    const initialColors = initialItems.map((item) =>
      item.querySelector<HTMLElement>('.results-candidate-number')!.style.backgroundColor,
    )
    const initialSegments = [...screen.getByRole('img').querySelectorAll<HTMLElement>('.results-stack-segment')]
      .map((segment) => [segment.dataset.candidateId, segment.style.backgroundColor])
    expect(new Set(initialColors).size).toBe(initialItems.length)
    rerender(<ResultsPanel snapshot={{
      ...value,
      candidates: [...value.candidates].reverse().map((candidate) => ({
        ...candidate,
        votes: candidate.id === 'a' ? 1500 : 500,
      })),
    }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nome' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nome' }))
    const updatedItems = within(list).getAllByRole('listitem')
    expect(updatedItems[0]).toHaveTextContent('Ana Silva')
    expect(updatedItems.map((item) =>
      item.querySelector<HTMLElement>('.results-candidate-number')!.style.backgroundColor,
    )).toEqual(initialColors)
    const updatedSegments = [...screen.getByRole('img').querySelectorAll<HTMLElement>('.results-stack-segment')]
    expect(updatedSegments.map((segment) => [segment.dataset.candidateId, segment.style.backgroundColor]))
      .toEqual(initialSegments)
    expect(updatedSegments[0]).toHaveStyle({ width: '75%' })
    expect(updatedSegments[1]).toHaveStyle({ width: '25%' })
    expect(candidateRows()[0]).toHaveTextContent('Beatriz Souza')
  })

  it('uses PT red and PL blue in a proportional stacked bar with a 50% reference', () => {
    const value = snapshot()
    value.candidates = value.candidates.map((candidate) => ({
      ...candidate, party: candidate.number === '13' ? 'PT' : 'PL',
    }))
    render(<ResultsPanel snapshot={value} />)
    const chart = screen.getByRole('img', { name: /Comparação dos votos válidos/ })
    expect(chart).toHaveAccessibleName(/Ana Silva, PT, 40,00%.*Beatriz Souza, PL, 60,00%.*50%/)
    const segments = chart.querySelectorAll<HTMLElement>('.results-stack-segment')
    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveStyle({ width: '40%', backgroundColor: '#c41e3a' })
    expect(segments[1]).toHaveStyle({ width: '60%', backgroundColor: '#155eab' })
    expect(chart.querySelector('.results-midpoint')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeVisible()
    expect(screen.getByText(/Liderança nos votos apurados/)).toHaveTextContent('Beatriz Souza')
    expect(screen.queryByText('Eleito(a) · TSE')).not.toBeInTheDocument()
  })

  it('uses unrounded valid-vote shares and keeps the reference independent of counting progress', () => {
    const value = snapshot({ validVotes: 3, sections: { counted: 10, total: 100 } })
    value.candidates = value.candidates.map((candidate) => ({
      ...candidate, votes: candidate.number === '13' ? 1 : 2,
    }))
    render(<ResultsPanel snapshot={value} />)
    const chart = screen.getByRole('img', { name: /Comparação dos votos válidos/ })
    const segments = chart.querySelectorAll<HTMLElement>('.results-stack-segment')
    expect(parseFloat(segments[0]!.style.width)).toBeCloseTo(100 / 3, 10)
    expect(parseFloat(segments[1]!.style.width)).toBeCloseTo(200 / 3, 10)
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '10')
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('shows a tie without suggesting a winner', () => {
    const value = snapshot()
    value.candidates = value.candidates.map((candidate) => ({ ...candidate, votes: 1000 }))
    render(<ResultsPanel snapshot={value} />)
    expect(screen.getByText(/Empate nos votos contabilizados/)).toBeVisible()
    expect(screen.queryByText(/Liderança nos votos apurados/)).not.toBeInTheDocument()
    for (const segment of screen.getByRole('img').querySelectorAll('.results-stack-segment')) {
      expect(segment).toHaveStyle({ width: '50%' })
    }
  })

  it('does not manufacture a full-width comparison for absent or non-reconciling valid votes', () => {
    const { rerender } = render(<ResultsPanel snapshot={snapshot({ validVotes: 0, candidates: [] })} />)
    let chart = screen.getByRole('img', { name: /Comparação gráfica indisponível/ })
    expect(chart.querySelectorAll('.results-stack-segment')).toHaveLength(0)
    expect(screen.queryByText(/Liderança nos votos apurados/)).not.toBeInTheDocument()
    rerender(<ResultsPanel snapshot={snapshot({ validVotes: 1900 })} />)
    chart = screen.getByRole('img', { name: /Comparação gráfica indisponível/ })
    expect(chart.querySelectorAll('.results-stack-segment')).toHaveLength(0)
    expect(screen.getByText(/Gráfico indisponível/)).toBeVisible()
  })

  it('shows aggregate source range, fetch time, coverage and asynchronous snapshot disclaimer', () => {
    render(<ResultsPanel snapshot={snapshot({
      geography: { id: 'domestic', kind: 'domestic', label: 'Brasil' },
      sourceTimes: { oldest: '2026-10-25T21:00:00Z', latest: '2026-10-25T21:05:00Z' },
      fetchedAt: '2026-10-25T21:06:00Z',
      coverage: { received: 26, expected: 27 },
    })} />)
    expect(screen.getByText('Intervalo de atualização na fonte').nextElementSibling)
      .toHaveTextContent('25/10/2026, 18:00:00 até 25/10/2026, 18:05:00')
    expect(screen.getByText('Consulta aos dados').nextElementSibling)
      .toHaveTextContent('25/10/2026, 18:06:00')
    expect(screen.getByText(/America\/Sao_Paulo/)).toBeInTheDocument()
    expect(screen.getByText('26 de 27').parentElement).toHaveTextContent('Cobertura incompleta')
    expect(screen.getByText(/não formam um retrato simultâneo/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tribunal Superior Eleitoral/ }))
      .toHaveAttribute('href', 'https://resultados.tse.jus.br/oficial/app/index.html')
  })

  it('never declares a leader elected, even when counting is complete', () => {
    const value = snapshot({ countingComplete: true })
    const { rerender } = render(<ResultsPanel snapshot={value} />)
    expect(screen.getByText('Apuração concluída na fonte')).toBeInTheDocument()
    expect(screen.queryByText('Eleito(a) · TSE')).not.toBeInTheDocument()
    expect(screen.queryByText(/vencedor|vitória|ganhou/i)).not.toBeInTheDocument()
    rerender(<ResultsPanel snapshot={{
      ...value,
      countingComplete: false,
      candidates: value.candidates.map((candidate) => ({ ...candidate, elected: candidate.id === 'a' })),
    }} />)
    expect(screen.getAllByText('Eleito(a) · TSE')).toHaveLength(2)
    expect(screen.getByText('Apuração em andamento')).toBeInTheDocument()
    expect(within(candidateRows()[0]!).getByText('Eleito(a) · TSE')).toBeInTheDocument()
  })
})
