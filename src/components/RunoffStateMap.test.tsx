import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import boundaries from '../data/geography/brazil-states.json'
import type { ComparisonRound, Finalist, RoundComparison } from '../domain/comparison'
import type { ElectionMetadata } from '../domain/geography'
import { RunoffStateMap } from './RunoffStateMap'

const finalists: Finalist[] = [
  { id: '13', number: '13', name: 'Lula', party: 'PT' },
  { id: '22', number: '22', name: 'Flávio Bolsonaro', party: 'PL' },
]
const metadata: ElectionMetadata = {
  election: { id: '6258', cycle: 'ele2026', name: 'Presidente', date: '2026-10-25', year: 2026, round: '2' },
  states: boundaries.states.map(({ code, name }) => ({ code, name, municipalities: [] })),
  countries: [], overseasMunicipalities: [],
}

function pair(code: string, overrides: Partial<ComparisonRound> = {}): RoundComparison {
  const second: ComparisonRound = {
    electionId: '6258', validVotes: 100, totalVotes: 100, blankVotes: 0, nullVotes: 0,
    votes: { '13': 40, '22': 60 }, otherVotes: 0, sections: { total: 10, counted: 10 },
    countingComplete: true, sourceTimes: { oldest: '2026-10-26T01:00:00Z', latest: '2026-10-26T01:00:00Z' },
    coverage: { received: 1, expected: 1 },
  }
  return {
    geography: { id: `state:${code}`, kind: 'state', label: code },
    first: { ...second, electionId: '6257', votes: { '13': 60, '22': 40 } },
    second: { ...second, ...overrides },
  }
}

function show(comparisons = [pair('sp'), pair('df', { votes: { '13': 75, '22': 25 } })]) {
  return render(<RunoffStateMap metadata={metadata} comparisons={comparisons} finalists={[...finalists].reverse()} />)
}

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('second-round state map', () => {
  it('bundles all 27 official IBGE UFs, including DF, with paths and distinct numeric codes', () => {
    expect(boundaries.states.map(({ code }) => code).sort()).toEqual([
      'ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt',
      'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to',
    ])
    expect(new Set(boundaries.states.map(({ ibgeCode }) => ibgeCode)).size).toBe(27)
    expect(boundaries.states.find(({ code }) => code === 'df')?.ibgeCode).toBe('53')
    for (const state of boundaries.states) {
      expect(state.path).toMatch(/^M[\d.,LZM-]+Z$/)
      expect(state.center.every(Number.isFinite)).toBe(true)
      expect(state.label.every(Number.isFinite)).toBe(true)
    }
    expect(boundaries.source).toMatch(/^https:\/\/geoftp\.ibge\.gov\.br\//)
    expect(boundaries.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses only second-round state counts, shares and shared party colors without requests', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    show()
    const map = screen.getByRole('group', { name: 'Mapa do Brasil por UF' })
    expect(within(map).getAllByRole('link')).toHaveLength(27)
    const sp = within(map).getByRole('link', { name: /São Paulo .*Flávio Bolsonaro.*60,00%/ })
    const df = within(map).getByRole('link', { name: /Distrito Federal .*Lula.*75,00%/ })
    expect(sp).toHaveAttribute('data-winner', '22')
    expect(sp.querySelector('path')).toHaveAttribute('fill', '#155eab')
    expect(df.querySelector('path')).toHaveAttribute('fill', '#c41e3a')
    expect(fetch).not.toHaveBeenCalled()
    const alternative = screen.getByRole('navigation', { name: 'Alternativa ao mapa: selecionar UF' })
    expect(within(alternative).getAllByRole('link')).toHaveLength(27)
    expect(within(alternative).getByRole('link', { name: /Distrito Federal: Mais votado: Lula/ })).toHaveTextContent('DF')
  })

  it.each([
    ['tie', { votes: { '13': 50, '22': 50 } }, /Empate/],
    ['zero valid votes', { validVotes: 0, totalVotes: 0, votes: { '13': 0, '22': 0 } }, /Sem votos válidos/],
    ['not final', { countingComplete: false }, /Resultado indisponível/],
    ['incomplete coverage', { coverage: { received: 0, expected: 1 } }, /Resultado indisponível/],
    ['missing candidate', { votes: { '13': 100 } }, /Resultado indisponível/],
    ['unreconciled counts', { validVotes: 101 }, /Resultado indisponível/],
    ['wrong round', { electionId: '6257' }, /Resultado indisponível/],
    ['unexpected candidate', { otherVotes: 1, validVotes: 101, totalVotes: 101 }, /Resultado indisponível/],
  ] as const)('shows %s as neutral, with an explicit textual reason', (_name, changes, reason) => {
    show([pair('sp', changes)])
    const map = screen.getByRole('group', { name: 'Mapa do Brasil por UF' })
    const sp = within(map).getByRole('link', { name: /São Paulo/ })
    expect(sp).toHaveAccessibleName(reason)
    expect(sp).toHaveAttribute('data-winner', 'neutral')
    expect(sp.querySelector('path')).toHaveAttribute('fill', '#65717c')
    expect(within(map).getByRole('link', { name: /Distrito Federal/ })).toHaveAccessibleName(/Resultado indisponível/)
  })

  it('keeps state drill-down links focusable and preserves modified-click navigation', () => {
    show()
    const map = screen.getByRole('group', { name: 'Mapa do Brasil por UF' })
    const link = within(map).getByRole('link', { name: /São Paulo/ })
    expect(link).toHaveAttribute('href', '?visao=brasil&uf=sp')
    expect(link).toHaveAttribute('tabindex', '0')
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      document.addEventListener('click', (event) => event.preventDefault(), { once: true })
      fireEvent.click(link, { [modifier]: true })
      expect(window.location.search).toBe('')
    }
    fireEvent.click(link)
    expect(window.location.search).toBe('?visao=brasil&uf=sp')
  })
})
