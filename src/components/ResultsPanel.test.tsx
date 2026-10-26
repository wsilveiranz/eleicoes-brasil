import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ComparisonRound, DatasetSummary, Finalist, RoundComparison } from '../domain/comparison'
import { candidateColor } from './candidateColors'
import { ResultsPanel, ResultsProvenance } from './ResultsPanel'

const finalists: Finalist[] = [
  { id: '22', number: '22', name: 'Bolsonaro', party: 'PL' },
  { id: '13', number: '13', name: 'Lula', party: 'PT' },
]
const elections: DatasetSummary['elections'] = {
  first: { id: '6257', cycle: 'ele2026', name: 'Presidente', year: 2026, round: '1', date: '2026-10-04' },
  second: { id: '6258', cycle: 'ele2026', name: 'Presidente', year: 2026, round: '2', date: '2026-10-25' },
}

function round(overrides: Partial<ComparisonRound> = {}): ComparisonRound {
  return {
    electionId: '6257',
    validVotes: 2000,
    totalVotes: 2500,
    blankVotes: 200,
    nullVotes: 300,
    votes: { '22': 1000, '13': 800 },
    otherVotes: 200,
    sections: { total: 100, counted: 100 },
    countingComplete: true,
    sourceTimes: { oldest: '2026-10-05T01:00:00Z', latest: '2026-10-05T01:00:00Z' },
    coverage: { received: 27, expected: 27 },
    ...overrides,
  }
}

function comparison(first: Partial<ComparisonRound> = {}, second: Partial<ComparisonRound> = {}): RoundComparison {
  return {
    geography: { id: 'br', kind: 'overall', label: 'Total geral' },
    first: round(first),
    second: round({
      electionId: '6258', votes: { '13': 1500, '22': 900 },
      validVotes: 2400, totalVotes: 3000, blankVotes: 100, nullVotes: 500, otherVotes: 0,
      sourceTimes: { oldest: '2026-10-26T01:00:00Z', latest: '2026-10-26T01:05:00Z' },
      ...second,
    }),
  }
}

function panel(value = comparison(), candidates = finalists) {
  return <><ResultsPanel comparison={value} finalists={candidates} elections={elections} /><ResultsProvenance comparison={value} /></>
}

function candidateRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1, -1)
}

function stacks() {
  return screen.getAllByRole('img').filter((element) => element.classList.contains('results-stack-track'))
}

function segments(chart: HTMLElement) {
  return [...chart.querySelectorAll<HTMLElement>('.results-stack-segment')]
}

function totalCard(label: string) {
  return screen.getByText(label).closest('div')!
}

describe('ResultsPanel', () => {
  it('summarizes round totals, signed vote growth and relative growth in neutral cards', () => {
    render(panel())
    expect(screen.getByRole('heading', { name: /Presidente · comparação entre turnos/ })).toBeVisible()
    expect(totalCard('Votos válidos · 1º turno')).toHaveTextContent('2.000')
    expect(totalCard('Votos válidos · 2º turno')).toHaveTextContent('2.400')
    expect(totalCard('Variação absoluta de válidos')).toHaveTextContent('+400')
    expect(totalCard('Variação relativa de válidos')).toHaveTextContent('+20,00%')
    expect(screen.getByText(/dados congelados/)).toBeVisible()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/Liderança|Eleito\(a\)|Empate nos votos/)).not.toBeInTheDocument()
  })

  it('shows negative and unchanged total changes without conflating relative percent with pp', () => {
    const initial = comparison()
    const { rerender } = render(panel(comparison(
      { ...initial.second, electionId: '6257' },
      { ...initial.first, electionId: '6258', otherVotes: 0, votes: { '13': 800, '22': 1200 } },
    )))
    expect(totalCard('Variação absoluta de válidos')).toHaveTextContent('−400')
    expect(totalCard('Variação relativa de válidos')).toHaveTextContent('−16,67%')
    rerender(panel(comparison({}, { validVotes: 2000, totalVotes: 2500, blankVotes: 200, nullVotes: 300, votes: { '13': 1000, '22': 1000 } })))
    expect(totalCard('Variação absoluta de válidos').querySelector('dd')).toHaveTextContent(/^0$/)
    expect(totalCard('Variação relativa de válidos').querySelector('dd')).toHaveTextContent(/^0,00%$/)
  })

  it('normalizes tiny signed percentage/pp displays without changing raw counts, ratios or integer deltas', () => {
    const first = {
      validVotes: 100000, totalVotes: 100000, blankVotes: 0, nullVotes: 0,
      votes: { '13': 50000, '22': 50000 }, otherVotes: 0,
    }
    const { rerender } = render(panel(comparison(first, first)))
    for (const delta of [1, -1]) {
      const second = {
        ...first, validVotes: first.validVotes + delta, totalVotes: first.totalVotes + delta,
        votes: { '13': 50000 + delta, '22': 50000 },
      }
      rerender(panel(comparison(first, second)))
      expect(totalCard('Variação relativa de válidos').querySelector('dd')).toHaveTextContent(/^0,00%$/)
      expect(totalCard('Variação absoluta de válidos').querySelector('dd')).toHaveTextContent(delta > 0 ? '+1' : '−1')
      for (const row of candidateRows()) expect(row.lastElementChild).toHaveTextContent(/^0,00 pp$/)
      expect(candidateRows()[0]!.children[7]).toHaveTextContent(delta > 0 ? '+1' : '−1')
      expect(parseFloat(segments(stacks()[1]!)[0]!.style.width)).toBeCloseTo(
        second.votes['13'] / second.validVotes * 100, 10,
      )
      expect(second.votes['13']).toBe(50000 + delta)
      expect(screen.queryByText(/^[+−]0,00(?:%| pp)$/)).not.toBeInTheDocument()
    }
    rerender(panel(comparison(
      { ...first, validVotes: 20000, totalVotes: 20000, votes: { '13': 10000, '22': 10000 } },
      { ...first, validVotes: 20001, totalVotes: 20001, votes: { '13': 10001, '22': 10000 } },
    )))
    expect(totalCard('Variação relativa de válidos').querySelector('dd')).toHaveTextContent(/^\+0,01%$/)
  })

  it('renders two proportional stacks with fixed order, dates, own denominators and fixed 50% markers', () => {
    render(panel())
    const charts = stacks()
    expect(charts).toHaveLength(2)
    expect(segments(charts[0]!)).toHaveLength(3)
    expect(segments(charts[1]!)).toHaveLength(2)
    expect(segments(charts[0]!).map((element) => element.dataset.candidateId)).toEqual(['13', '22', 'others'])
    expect(segments(charts[1]!).map((element) => element.dataset.candidateId)).toEqual(['13', '22'])
    expect(segments(charts[0]!)[0]).toHaveStyle({ width: '40%', backgroundColor: '#c41e3a' })
    expect(segments(charts[0]!)[1]).toHaveStyle({ width: '50%', backgroundColor: '#155eab' })
    expect(segments(charts[0]!)[2]).toHaveStyle({ width: '10%', backgroundColor: '#65717c' })
    expect(segments(charts[1]!)[0]).toHaveStyle({ width: '62.5%' })
    expect(segments(charts[1]!)[1]).toHaveStyle({ width: '37.5%' })
    for (const chart of charts) {
      expect(chart.querySelector('.results-midpoint')).toBeInTheDocument()
      expect(chart).toHaveAccessibleName(/Referência fixa: 50%/)
    }
    expect(screen.getAllByText('0%')).toHaveLength(2)
    expect(screen.getAllByText('50%')).toHaveLength(2)
    expect(screen.getAllByText('100%')).toHaveLength(2)
    expect(screen.getByText('Denominador: 2.000 votos válidos neste turno.')).toBeVisible()
    expect(screen.getByText('Denominador: 2.400 votos válidos neste turno.')).toBeVisible()
    expect(screen.getByText('04/10/2026')).toHaveAttribute('datetime', '2026-10-04')
    expect(screen.getByText('25/10/2026')).toHaveAttribute('datetime', '2026-10-25')
    expect(screen.getByText(/não avanço da apuração ou transferência/)).toBeVisible()
  })

  it('uses unrounded ratios for segment widths and percentage-point changes', () => {
    render(panel(comparison(
      { validVotes: 3, totalVotes: 3, blankVotes: 0, nullVotes: 0, votes: { '13': 1, '22': 1 }, otherVotes: 1 },
      { validVotes: 7, totalVotes: 7, blankVotes: 0, nullVotes: 0, votes: { '13': 2, '22': 5 } },
    )))
    expect(parseFloat(segments(stacks()[0]!)[0]!.style.width)).toBeCloseTo(100 / 3, 10)
    expect(parseFloat(segments(stacks()[1]!)[0]!.style.width)).toBeCloseTo(200 / 7, 10)
    const lula = candidateRows()[0]!
    expect(lula).toHaveTextContent('33,33%')
    expect(lula).toHaveTextContent('28,57%')
    expect(lula).toHaveTextContent('−4,76 pp')
    expect(lula).not.toHaveTextContent('−4,76%')
  })

  it('keeps full labels outside the tracks for zero and tiny segments', () => {
    render(panel(comparison(
      { validVotes: 100000, totalVotes: 100000, blankVotes: 0, nullVotes: 0, votes: { '13': 1, '22': 99999 }, otherVotes: 0 },
      { validVotes: 100000, totalVotes: 100000, blankVotes: 0, nullVotes: 0, votes: { '13': 0, '22': 100000 } },
    )))
    const firstLabels = screen.getByRole('list', { name: 'Valores do 1º turno' })
    expect(within(firstLabels).getByText('13 · Lula · PT')).toBeVisible()
    expect(within(firstLabels).getByText('1 votos')).toBeVisible()
    expect(within(firstLabels).getByText('Outros')).toBeVisible()
    const secondLabels = screen.getByRole('list', { name: 'Valores do 2º turno' })
    expect(within(secondLabels).getByText('13 · Lula · PT')).toBeVisible()
    expect(within(secondLabels).getByText('0 votos')).toBeVisible()
    expect(within(secondLabels).getByText('0,00%')).toBeVisible()
    expect(segments(stacks()[0]!)[0]).toHaveStyle({ width: '0.001%' })
    expect(segments(stacks()[1]!)[0]).toHaveStyle({ width: '0%' })
    for (const chart of stacks()) expect(chart).toHaveTextContent('')
  })

  it('does not invent 50/50 shares, growth, or full-width bars for zero denominators', () => {
    const zero = { validVotes: 0, totalVotes: 0, blankVotes: 0, nullVotes: 0, votes: { '13': 0, '22': 0 }, otherVotes: 0 }
    render(panel(comparison(zero, zero)))
    for (const chart of stacks()) {
      expect(segments(chart)).toHaveLength(0)
      expect(chart).toHaveAccessibleName(/Sem votos válidos/)
    }
    for (const row of candidateRows()) {
      expect(within(row).getAllByText('0')).toHaveLength(3)
      expect(within(row).getAllByText('—')).toHaveLength(3)
    }
    expect(totalCard('Variação relativa de válidos').querySelector('dd')).toHaveTextContent('—')
    expect(screen.getByText(/Base do 1º turno igual a zero/)).toBeVisible()
    for (const bar of document.querySelectorAll('.results-absolute-bar')) {
      expect(bar).toHaveStyle({ width: '0%' })
    }
    expect(screen.queryByText('50,00%')).not.toBeInTheDocument()
    expect(screen.getAllByText(/Sem votos contabilizados/)).toHaveLength(2)
    const others = screen.getByRole('row', { name: /^— Outros/ })
    expect(others.children[3]).toHaveTextContent(/^0$/)
    expect(others.children[4]).toHaveTextContent(/^—$/)
  })

  it('keeps absolute deltas available but relative/pp changes unavailable at a zero first-round base', () => {
    render(panel(comparison({
      validVotes: 0, totalVotes: 0, blankVotes: 0, nullVotes: 0,
      votes: { '13': 0, '22': 0 }, otherVotes: 0,
    })))
    expect(totalCard('Variação absoluta de válidos')).toHaveTextContent('+2.400')
    expect(totalCard('Variação relativa de válidos').querySelector('dd')).toHaveTextContent('—')
    expect(candidateRows()[0]).toHaveTextContent('+1.500')
    expect(within(candidateRows()[0]!).getAllByText('—')).toHaveLength(2)
    expect(candidateRows()[0]).toHaveTextContent('62,50%')
  })

  it('never silently renormalizes unreconciled round totals or displays analytical deltas for them', () => {
    render(panel(comparison({ validVotes: 1900, totalVotes: 2400 })))
    expect(segments(stacks()[0]!)).toHaveLength(0)
    expect(stacks()[0]).toHaveAccessibleName(/Gráfico indisponível.*não há renormalização/)
    expect(segments(stacks()[1]!)).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('Comparação analítica indisponível')
    expect(totalCard('Variação absoluta de válidos').querySelector('dd')).toHaveTextContent('—')
    expect(screen.getByText(/Gráfico indisponível: as contagens/)).toBeVisible()
  })

  it('does not hide an unexpected second-round Outros count by renormalizing just the finalists', () => {
    render(panel(comparison({}, { otherVotes: 1, validVotes: 2401, totalVotes: 3001 })))
    expect(segments(stacks()[1]!)).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent(/segundo turno contém candidatos além dos finalistas/)
    expect(within(screen.getByRole('table')).getByText('Outros')).toBeInTheDocument()
    const others = screen.getByRole('row', { name: /^— Outros/ })
    expect(others.children[4]).toHaveTextContent(/^—$/)
    for (const cell of [...others.children].slice(5)) expect(cell).toHaveTextContent(/^—$/)
  })

  it('reports missing candidate counts as unavailable instead of substituting zero', () => {
    render(panel(comparison({}, { votes: { '13': 1500 } })))
    expect(screen.getByRole('heading', { name: 'Comparação entre turnos indisponível' })).toBeVisible()
    expect(screen.getByText(/Dados ausentes não são tratados como zero/)).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('uses one shared zero-based maximum for all four absolute bars and labels rounds independently of color', () => {
    render(panel())
    const bars = [...document.querySelectorAll<HTMLElement>('.results-absolute-bar')]
    expect(bars.map((bar) => [bar.dataset.candidateId, bar.dataset.round])).toEqual([
      ['13', 'first'], ['13', 'second'], ['22', 'first'], ['22', 'second'],
    ])
    const expected = [800, 1500, 1000, 900]
    bars.forEach((bar, index) => {
      expect(parseFloat(bar.style.width)).toBeCloseTo(expected[index]! / 1500 * 100, 10)
    })
    expect(screen.getByText(/Escala única desde zero até 1.500 votos/)).toHaveTextContent('1º turno: preenchimento listrado; 2º turno: preenchimento sólido.')
    expect(screen.getByRole('img', { name: 'Lula, 1º turno: 800 votos. Escala de zero a 1.500 votos.' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Lula, 2º turno: 1.500 votos. Escala de zero a 1.500 votos.' })).toBeVisible()
    const list = document.querySelector('.results-absolute-candidates')!
    expect(within(list as HTMLElement).getAllByText('1º turno')).toHaveLength(2)
    expect(within(list as HTMLElement).getAllByText('2º turno')).toHaveLength(2)
  })

  it('provides finalist comparisons and first-round Others without inventing runoff votes or changes', () => {
    render(panel())
    const table = screen.getByRole('table', { name: 'Comparação de votos por candidatura' })
    expect(candidateRows()).toHaveLength(2)
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    const others = within(table).getByRole('row', { name: /^— Outros/ })
    expect(others.children[3]).toHaveTextContent(/^200$/)
    expect(others.children[4]).toHaveTextContent(/^10,00%$/)
    for (const cell of [...others.children].slice(5)) expect(cell).toHaveTextContent(/^—$/)
    expect(candidateRows()[0]).toHaveTextContent('Lula')
    expect(candidateRows()[0]).toHaveTextContent('800')
    expect(candidateRows()[0]).toHaveTextContent('40,00%')
    expect(candidateRows()[0]).toHaveTextContent('1.500')
    expect(candidateRows()[0]).toHaveTextContent('62,50%')
    expect(candidateRows()[0]).toHaveTextContent('+700')
    expect(candidateRows()[0]).toHaveTextContent('+22,50 pp')
    expect(candidateRows()[1]).toHaveTextContent('−100')
    expect(candidateRows()[1]).toHaveTextContent('−12,50 pp')
    expect(screen.getByText(/não permitem estabelecer transferências de votos de eleitores individuais/)).toBeVisible()
    expect(screen.getByText(/pontos percentuais \(pp\), não em variação relativa/)).toBeVisible()
  })

  it('exposes focusable sorting controls, semantic headers, and independently scrollable table', () => {
    render(panel())
    const numberHeader = screen.getByRole('columnheader', { name: 'Número' })
    expect(numberHeader).toHaveAttribute('aria-sort', 'ascending')
    const votes = screen.getByRole('button', { name: 'Votos · 2º turno' })
    votes.focus()
    expect(votes).toHaveFocus()
    expect(votes).toHaveAttribute('type', 'button')
    fireEvent.click(votes)
    expect(candidateRows()[0]).toHaveTextContent('Bolsonaro')
    expect(screen.getByRole('columnheader', { name: 'Votos · 2º turno' })).toHaveAttribute('aria-sort', 'ascending')
    expect(numberHeader).toHaveAttribute('aria-sort', 'none')
    fireEvent.click(votes)
    expect(candidateRows()[0]).toHaveTextContent('Lula')
    expect(votes).toHaveFocus()
    expect(screen.getByRole('columnheader', { name: 'Votos · 2º turno' })).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(screen.getByRole('button', { name: 'Variação em pp' }))
    expect(candidateRows()[0]).toHaveTextContent('Bolsonaro')
    expect(screen.getByRole('region', { name: 'Tabela de votos por candidatura' })).toHaveAttribute('tabindex', '0')
    expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(3)
    expect(within(screen.getByRole('table')).getAllByRole('row').at(-1)).toHaveTextContent('Outros')
  })

  it('uses stable chart ordering and colors when votes reverse, source order changes and table is sorted', () => {
    const value = comparison()
    const { rerender } = render(panel(value))
    const original = stacks().map((chart) => segments(chart).map((element) => [element.dataset.candidateId, element.style.backgroundColor]))
    fireEvent.click(screen.getByRole('button', { name: 'Nome' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nome' }))
    rerender(panel({
      ...value,
      second: { ...value.second, votes: { '22': 1600, '13': 800 } },
    }, [...finalists].reverse()))
    expect(stacks().map((chart) => segments(chart).map((element) => [element.dataset.candidateId, element.style.backgroundColor]))).toEqual(original)
    expect(candidateRows()[0]).toHaveTextContent('Lula')
    expect(parseFloat(segments(stacks()[1]!)[0]!.style.width)).toBeCloseTo(100 / 3, 10)
    expect(document.querySelector('.results-absolute-candidates li')).toHaveTextContent('13 Lula')
  })

  it('keeps tied values deterministically ordered by ballot number', () => {
    render(panel(comparison({}, { votes: { '13': 1200, '22': 1200 } })))
    fireEvent.click(screen.getByRole('button', { name: 'Votos · 2º turno' }))
    expect(candidateRows()[0]).toHaveTextContent('Lula')
    fireEvent.click(screen.getByRole('button', { name: 'Votos · 2º turno' }))
    expect(candidateRows()[0]).toHaveTextContent('Lula')
    expect(segments(stacks()[1]!)[0]).toHaveStyle({ width: '50%' })
    expect(segments(stacks()[1]!)[1]).toHaveStyle({ width: '50%' })
  })

  it('retains per-round ballot denominators, source ranges, finality, coverage and source attribution', () => {
    render(panel())
    const summary = screen.getByText('Fonte, cobertura e demais votos')
    expect(summary.parentElement).not.toHaveAttribute('open')
    fireEvent.click(summary)
    const first = screen.getByRole('region', { name: 'Fonte e cédulas do 1º turno' })
    const second = screen.getByRole('region', { name: 'Fonte e cédulas do 2º turno' })
    expect(within(first).getByText('Total de votos').nextElementSibling).toHaveTextContent('2.500')
    expect(within(first).getByText('Em branco').nextElementSibling).toHaveTextContent('200 (8,00% do total)')
    expect(within(second).getByText('Em branco').nextElementSibling).toHaveTextContent('100 (3,33% do total)')
    expect(within(second).getByText('Nulos').nextElementSibling).toHaveTextContent('500 (16,67% do total)')
    expect(within(first).getByText('Atualização na fonte').nextElementSibling).toHaveTextContent('04/10/2026, 22:00:00')
    expect(within(second).getByText('Intervalo de atualização na fonte').nextElementSibling).toHaveTextContent('25/10/2026, 22:00:00 até 25/10/2026, 22:05:00')
    expect(within(first).getByText('Apuração concluída na fonte')).toBeVisible()
    expect(within(second).getByText('Cobertura').nextElementSibling).toHaveTextContent('27 de 27 fontes recebidas.')
    expect(screen.getByText(/America\/Sao_Paulo/)).toBeVisible()
    expect(screen.getByText(/não formam um retrato simultâneo/)).toBeVisible()
    expect(screen.getByRole('link', { name: /Tribunal Superior Eleitoral/ })).toHaveAttribute('href', 'https://resultados.tse.jus.br/oficial/app/index.html')
    expect(screen.queryByText(/Consulta aos dados/)).not.toBeInTheDocument()
  })

  it('reports incomplete finality/coverage as secondary provenance, never fabricated complete analysis', () => {
    render(panel(comparison({
      countingComplete: false, sections: { total: 100, counted: 90 }, coverage: { received: 26, expected: 27 },
    })))
    fireEvent.click(screen.getByText('Fonte, cobertura e demais votos'))
    const first = screen.getByRole('region', { name: 'Fonte e cédulas do 1º turno' })
    expect(within(first).getByText('Apuração não concluída na fonte')).toBeVisible()
    expect(within(first).getByText('Cobertura').nextElementSibling).toHaveTextContent('26 de 27 fontes recebidas. Cobertura incompleta')
    expect(screen.getByRole('status')).toHaveTextContent('Variações não são calculadas com dados inválidos ou incompletos')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('uses the specified stable party colors with at least 4.5:1 contrast for white badge text', () => {
    function luminance(color: string) {
      const channels = color.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16) / 255)
        .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
      return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722
    }
    expect(candidateColor(finalists[1]!)).toBe('#c41e3a')
    expect(candidateColor(finalists[0]!)).toBe('#155eab')
    for (const finalist of finalists) {
      expect(1.05 / (luminance(candidateColor(finalist)) + .05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
