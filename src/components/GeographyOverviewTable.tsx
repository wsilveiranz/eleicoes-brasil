import { useCallback, useId, useMemo, useState } from 'react'
import { loadSelectionResult } from '../data/results'
import type { CountryMetadata, ElectionMetadata } from '../domain/geography'
import { normalizeGeographySearch } from '../domain/geography'
import { percentage, type CandidateResult, type ResultSnapshot } from '../domain/results'
import { selectionId, selectionSearch, type Selection } from '../domain/selection'
import { useLiveResult } from '../hooks/useLiveResult'
import { navigate } from '../hooks/useSelection'
import '../styles/geography-table.css'

const integer = new Intl.NumberFormat('pt-BR')
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })
const timestamp = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
})

function share(count: number, total: number) {
  const value = percentage(count, total)
  return value === null ? '—' : `${percent.format(value)}%`
}

function GeographyRow({
  name,
  selection,
  candidates,
  snapshot,
  error = null,
  hidden = false,
}: {
  name: string
  selection: Selection
  candidates: CandidateResult[]
  snapshot: ResultSnapshot | undefined
  error?: Error | null
  hidden?: boolean
}) {
  return (
    <tr hidden={hidden}>
      <th scope="row">
        <a
          href={selectionSearch(selection)}
          onClick={(event) => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            navigate(selection)
          }}
        >
          {name}
        </a>
        {snapshot && (
          <small>
            Fonte: <time dateTime={snapshot.sourceTimes.latest}>
              {timestamp.format(new Date(snapshot.sourceTimes.latest))}
            </time>
          </small>
        )}
        {error && (
          <small className="geography-row-error">
            {snapshot ? 'Dados desatualizados. ' : 'Indisponível. '}{error.message}
          </small>
        )}
        {!snapshot && !error && <small>Consultando…</small>}
      </th>
      <td className="geography-number">
        {snapshot ? (
          <>
            <strong>{share(snapshot.sections.counted, snapshot.sections.total)}</strong>
            <small>
              {integer.format(snapshot.sections.counted)} de {integer.format(snapshot.sections.total)} seções
            </small>
          </>
        ) : '—'}
      </td>
      {candidates.map((candidate) => {
        const local = snapshot?.candidates.find((item) => item.id === candidate.id)
        return (
          <td key={candidate.id} className="geography-number">
            {snapshot && local ? (
              <>
                <strong>{integer.format(local.votes)} votos</strong>
                <small>{share(local.votes, snapshot.validVotes)} dos válidos</small>
              </>
            ) : snapshot ? 'Candidatura não informada' : '—'}
          </td>
        )
      })}
    </tr>
  )
}

function CountryRow({
  country, metadata, candidates, visible,
}: {
  country: CountryMetadata
  metadata: ElectionMetadata
  candidates: CandidateResult[]
  visible: boolean
}) {
  const selection = useMemo<Selection>(
    () => ({ scope: 'overseas', country: country.code }),
    [country.code],
  )
  const key = useMemo(
    () => ['results', metadata.election.id, selectionId(selection)],
    [metadata.election.id, selection],
  )
  const load = useCallback(
    (signal: AbortSignal) => loadSelectionResult(metadata, selection, signal),
    [metadata, selection],
  )
  const query = useLiveResult(key, load)
  return (
    <GeographyRow
      name={country.name}
      selection={selection}
      candidates={candidates}
      snapshot={query.data}
      error={query.error}
      hidden={!visible}
    />
  )
}

export function GeographyOverviewTable({
  metadata, scope, snapshot,
}: {
  metadata: ElectionMetadata
  scope: 'domestic' | 'overseas'
  snapshot: ResultSnapshot
}) {
  const headingId = useId()
  const hintId = useId()
  const tableId = useId()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const domestic = scope === 'domestic'
  const title = domestic ? 'Resultados por estado' : 'Resultados por país de votação'
  const candidates = [...snapshot.candidates].sort(
    (a, b) => collator.compare(a.number, b.number) || collator.compare(a.id, b.id),
  )
  const states = [...metadata.states].sort((a, b) => collator.compare(a.name, b.name))
  const countries = [...metadata.countries].sort((a, b) => collator.compare(a.name, b.name))
  const locations = domestic ? states : countries
  const term = normalizeGeographySearch(search.trim())
  const visible = new Set(locations.filter((location) =>
    (!filter || location.code === filter) &&
    normalizeGeographySearch(`${location.name} ${location.code}`).includes(term),
  ).map((location) => location.code))

  return (
    <section className="geography-table-card" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <p id={hintId}>
        Apuração: seções contabilizadas sobre o total de seções.
        Cada candidatura mostra votos e percentual dos votos válidos da própria localidade.
        Selecione um nome para detalhar.
      </p>
      {!domestic && (
        <p>
          Os países são consultados independentemente, com até quatro requisições simultâneas.
          Uma falha não transforma resultados ausentes em zero. As linhas podem ter horários diferentes.
        </p>
      )}
      <div className="geography-table-filters">
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
        {visible.size} de {locations.length} {domestic ? 'estados/DF' : 'países de votação'}.
        Os filtros alteram apenas a tabela, não o resultado geral.
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
              <th scope="col">{domestic ? 'Estado / DF' : 'País de votação'}</th>
              <th scope="col" className="geography-number">Apuração</th>
              {candidates.map((candidate) => (
                <th key={candidate.id} scope="col" className="geography-number">
                  {candidate.number} · {candidate.name}
                  <small>{candidate.party} · Votos e % dos válidos</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {domestic ? states.map((state) => (
              <GeographyRow
                key={state.code}
                name={state.name}
                selection={{ scope: 'domestic', state: state.code }}
                candidates={candidates}
                snapshot={snapshot.constituents?.find((item) => item.geography.id === `state:${state.code}`)}
                error={snapshot.constituents?.some((item) => item.geography.id === `state:${state.code}`)
                  ? null : new Error('O resultado deste estado não está disponível nesta consulta.')}
                hidden={!visible.has(state.code)}
              />
            )) : countries.map((country) => (
              <CountryRow
                key={country.code}
                metadata={metadata}
                country={country}
                candidates={candidates}
                visible={visible.has(country.code)}
              />
            ))}
            {visible.size === 0 && (
              <tr><td colSpan={2 + candidates.length}>Nenhuma localidade encontrada. Limpe ou altere os filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="geography-table-note">
        Horários em Brasília (America/Sao_Paulo). Atualização automática com a aba visível;
        percentuais sem denominador são indicados por —. Em telas pequenas, deslize a tabela horizontalmente.
      </p>
    </section>
  )
}
