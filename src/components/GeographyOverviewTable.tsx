import { useId, useMemo, useState } from 'react'
import {
  candidateComparison, validVoteComparison, type Finalist, type RoundComparison,
} from '../domain/comparison'
import { normalizeGeographySearch, type ElectionMetadata } from '../domain/geography'
import { selectionSearch, type Selection } from '../domain/selection'
import { navigate } from '../hooks/useSelection'
import { candidateColor } from './candidateColors'
import '../styles/geography-table.css'

const integer = new Intl.NumberFormat('pt-BR')
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signedInteger = new Intl.NumberFormat('pt-BR', { signDisplay: 'exceptZero' })
const signedDecimal = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero',
})
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
type SortKey = 'name' | 'firstVotes' | 'secondVotes' | 'voteChange' | 'trend'
type Metrics = {
  firstVotes: number
  secondVotes: number
  firstShare: number | null
  secondShare: number | null
  voteChange: number
  trend: number | null
}

function metricsFor(comparison: RoundComparison | undefined, finalist: Finalist | undefined): Metrics | undefined {
  if (!comparison?.first || !comparison.second) return
  if (finalist) {
    if (!Object.hasOwn(comparison.first.votes, finalist.id) ||
      !Object.hasOwn(comparison.second.votes, finalist.id)) return
    const value = candidateComparison(comparison, finalist.id)
    return { ...value, trend: value.percentagePointChange }
  }
  const value = validVoteComparison(comparison)
  return { ...value, firstShare: null, secondShare: null, trend: value.relativeChange }
}

function formatSignedDecimal(value: number) {
  return signedDecimal.format(Math.abs(value) < 0.005 ? 0 : value)
}

export function GeographyOverviewTable({
  metadata, scope, comparisons, finalists,
}: {
  metadata: ElectionMetadata
  scope: 'domestic' | 'overseas'
  comparisons: RoundComparison[]
  finalists: Finalist[]
}) {
  const headingId = useId()
  const hintId = useId()
  const tableId = useId()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [sortMetric, setSortMetric] = useState('total')
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'name', descending: false })
  const domestic = scope === 'domestic'
  const title = domestic ? 'Resultados por estado' : 'Resultados por país de votação'
  const finalist = finalists.find(({ id }) => id === sortMetric)
  const candidates = [...finalists].sort((a, b) => collator.compare(a.number, b.number))
  const locations = [...(domestic ? metadata.states : metadata.countries)]
    .sort((a, b) => collator.compare(a.name, b.name))
  const byGeography = useMemo(
    () => new Map(comparisons.map((comparison) => [comparison.geography.id, comparison])),
    [comparisons],
  )
  const term = normalizeGeographySearch(search.trim())
  const rows = locations
    .filter((location) => (!filter || location.code === filter) &&
      normalizeGeographySearch(`${location.name} ${location.code}`).includes(term))
    .map((location) => {
      const comparison = byGeography.get(`${domestic ? 'state' : 'country'}:${location.code}`)
      return { ...location, comparison, metrics: metricsFor(comparison, finalist) }
    })
    .sort((a, b) => {
      const nameOrder = collator.compare(a.name, b.name) || collator.compare(a.code, b.code)
      if (sort.key === 'name') return sort.descending ? -nameOrder : nameOrder
      const left = a.metrics?.[sort.key]
      const right = b.metrics?.[sort.key]
      if (left == null) return right == null ? nameOrder : 1
      if (right == null) return -1
      return (sort.descending ? right - left : left - right) || nameOrder
    })

  function sortHeader(key: SortKey, label: string) {
    const active = sort.key === key
    return (
      <th
        scope="col"
        className={key === 'name' ? undefined : 'geography-number'}
        aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}
      >
        <button
          type="button"
          className="geography-sort"
          onClick={() => setSort({ key, descending: active ? !sort.descending : false })}
        >
          {label}<span aria-hidden="true">{active ? (sort.descending ? ' ↓' : ' ↑') : ' ↕'}</span>
        </button>
      </th>
    )
  }

  return (
    <section className="geography-table-card" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p id={hintId}>
        Compare os dois turnos. As variações são calculadas como 2º turno menos 1º turno.
        Cada localidade mostra o total válido, seguido das duas candidaturas.
        Selecione o nome da localidade para detalhar.
      </p>
      <div className="geography-table-filters">
        <div className="geography-field">
          <label htmlFor={`${tableId}-metric`}>Ordenar valores de</label>
          <select
            id={`${tableId}-metric`}
            value={sortMetric}
            onChange={(event) => setSortMetric(event.target.value)}
            aria-controls={tableId}
          >
            <option value="total">Total de votos válidos</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
          </select>
        </div>
        <div className="geography-field">
          <label htmlFor={`${tableId}-search`}>{domestic ? 'Buscar estado' : 'Buscar país de votação'}</label>
          <input
            id={`${tableId}-search`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-controls={tableId}
            autoComplete="off"
          />
        </div>
        <div className="geography-field">
          <label htmlFor={`${tableId}-filter`}>{domestic ? 'Estado' : 'País de votação'}</label>
          <select
            id={`${tableId}-filter`}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-controls={tableId}
          >
            <option value="">{domestic ? 'Todos os estados' : 'Todos os países de votação'}</option>
            {locations.map((location) => (
              <option key={location.code} value={location.code}>{location.name}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="app-action"
          disabled={!search && !filter}
          onClick={() => { setSearch(''); setFilter('') }}
        >
          Limpar filtros
        </button>
      </div>
      <p role="status">
        {rows.length} de {locations.length} {domestic ? 'estados/DF' : 'países de votação'}.
        Os filtros e a ordenação alteram apenas a tabela, não o resultado geral.
      </p>
      <p className="geography-sort-note">
        A ordenação numérica usa {finalist?.name ?? 'o total de votos válidos'}.
        As duas candidaturas permanecem sempre visíveis.
      </p>
      <div
        className="geography-table-scroll"
        role="region"
        aria-label={title}
        aria-describedby={hintId}
        tabIndex={0}
      >
        <table id={tableId} className="geography-results-table">
          <caption>{title}</caption>
          <thead>
            <tr>
              {sortHeader('name', domestic ? 'Estado / DF' : 'País de votação')}
              {sortHeader('firstVotes', '1º turno · votos')}
              {sortHeader('secondVotes', '2º turno · votos')}
              {sortHeader('voteChange', 'Variação de votos')}
              {sortHeader('trend', 'Variação relativa / p.p.')}
            </tr>
          </thead>
          {rows.map((row) => {
            const selection: Selection = domestic
              ? { scope: 'domestic', state: row.code }
              : { scope: 'overseas', country: row.code }
            const lines = [
              { candidate: undefined, value: metricsFor(row.comparison, undefined) },
              ...candidates.map((candidate) => ({
                candidate, value: metricsFor(row.comparison, candidate),
              })),
            ]
            return (
              <tbody key={row.code} aria-label={`Comparação: ${row.name}`}>
                {lines.map(({ candidate, value }) => (
                  <tr key={candidate?.id ?? 'total'} className={candidate ? 'geography-candidate-row' : 'geography-total-row'}>
                    <th scope="row">
                      {candidate ? (
                        <span className="geography-candidate-label">
                          <span className="geography-candidate-key" style={{ backgroundColor: candidateColor(candidate) }} aria-hidden="true" />
                          {candidate.number} · {candidate.name} · {candidate.party}
                        </span>
                      ) : (
                        <>
                          <a
                            href={selectionSearch(selection)}
                            onClick={(event) => {
                              if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                              event.preventDefault()
                              navigate(selection)
                            }}
                          >
                            {row.name}
                          </a>
                          <small>Total de votos válidos</small>
                        </>
                      )}
                      {!value && <small>Comparação indisponível: dados dos dois turnos ou da candidatura não disponíveis.</small>}
                    </th>
                    <td className="geography-number">
                      {value ? integer.format(value.firstVotes) : '—'}
                      {candidate && <small>{value?.firstShare == null ? '—' : `${decimal.format(value.firstShare)}% dos válidos`}</small>}
                    </td>
                    <td className="geography-number">
                      {value ? integer.format(value.secondVotes) : '—'}
                      {candidate && <small>{value?.secondShare == null ? '—' : `${decimal.format(value.secondShare)}% dos válidos`}</small>}
                    </td>
                    <td className="geography-number">{value ? signedInteger.format(value.voteChange) : '—'}</td>
                    <td className="geography-number">
                      {value?.trend == null ? '—' : `${formatSignedDecimal(value.trend)}${candidate ? ' p.p.' : '%'}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            )
          })}
          {rows.length === 0 && (
            <tbody><tr><td colSpan={5}>Nenhuma localidade encontrada. Limpe ou altere os filtros.</td></tr></tbody>
          )}
        </table>
      </div>
      <p className="geography-table-note">
        Horários e fontes de cada turno estão disponíveis no detalhamento da localidade.
        Cada percentual usa os votos válidos do respectivo turno e localidade.
        A variação relativa usa o total do 1º turno como base; p.p. significa pontos percentuais.
        Sem denominador ou sem um par válido, indicamos —. Em telas pequenas, deslize a tabela horizontalmente.
      </p>
    </section>
  )
}
