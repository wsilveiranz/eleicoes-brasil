import { useId, useState } from 'react'
import {
  candidateComparison, validVoteComparison, validateRoundComparison,
  type ComparisonRound, type DatasetSummary, type Finalist, type RoundComparison,
} from '../domain/comparison'
import { candidateColor } from './candidateColors'
import { ResultDataError } from '../domain/results'
import '../styles/results.css'

export interface ResultsPanelProps {
  comparison: RoundComparison
  finalists: Finalist[]
  elections: DatasetSummary['elections']
}

type CandidateValues = Omit<ReturnType<typeof candidateComparison>, 'voteChange'> & { voteChange: number | null }
type SortKey = 'number' | 'name' | 'party' | keyof CandidateValues
type SortDirection = 'ascending' | 'descending'

const numberFormat = new Intl.NumberFormat('pt-BR')
const decimalFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})
const timestampFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium',
})
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function percentText(value: number | null): string {
  return value === null ? '—' : `${decimalFormat.format(value)}%`
}

function signedText(value: number | null, unit: 'votes' | '%' | 'pp' = 'votes'): string {
  if (value === null) return '—'
  const displayed = unit !== 'votes' && Math.abs(value) < .005 ? 0 : value
  const sign = displayed > 0 ? '+' : displayed < 0 ? '−' : ''
  const formatted = unit === 'votes'
    ? numberFormat.format(Math.abs(displayed))
    : decimalFormat.format(Math.abs(displayed))
  return `${sign}${formatted}${unit === 'pp' ? ' pp' : unit === '%' ? '%' : ''}`
}

function shareText(count: number, total: number): string {
  return percentText(total === 0 ? null : count / total * 100)
}

function candidateOrder(a: Finalist, b: Finalist): number {
  return collator.compare(a.number, b.number) || collator.compare(a.id, b.id)
}

function ElectionDate({ value }: { value: string }) {
  return <time dateTime={value}>{value.split('-').reverse().join('/')}</time>
}

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{timestampFormat.format(new Date(value))}</time>
}

function RoundStack({
  round, finalists, label, date, showOthers,
}: {
  round: ComparisonRound
  finalists: Finalist[]
  label: string
  date: string
  showOthers: boolean
}) {
  const descriptionId = useId()
  const segments = finalists.map((candidate) => ({
    id: candidate.id,
    label: `${candidate.number} · ${candidate.name} · ${candidate.party}`,
    votes: round.votes[candidate.id]!,
    color: candidateColor(candidate),
  }))
  if (showOthers) {
    segments.push({ id: 'others', label: 'Outros', votes: round.otherVotes, color: '#65717c' })
  }
  const reconciled = segments.reduce((sum, segment) => sum + segment.votes, 0) === round.validVotes &&
    (showOthers || round.otherVotes === 0)
  const available = Number.isSafeInteger(round.validVotes) && round.validVotes > 0 && reconciled &&
    segments.every((segment) => Number.isSafeInteger(segment.votes) && segment.votes >= 0)
  const unavailable = round.validVotes === 0
    ? 'Sem votos válidos: percentuais indisponíveis (—).'
    : 'Gráfico indisponível: as contagens não coincidem com o total de votos válidos; não há renormalização.'

  return (
    <figure className="results-stacked-chart">
      <figcaption>
        <h4>{label} · <ElectionDate value={date} /></h4>
        <p className="results-muted" id={descriptionId}>
          Denominador: {numberFormat.format(round.validVotes)} votos válidos neste turno.
        </p>
      </figcaption>
      <div className="results-stack-scale" aria-hidden="true">
        <span>0%</span><strong>50%</strong><span>100%</span>
      </div>
      <div
        className="results-stack-track"
        role="img"
        aria-label={available
          ? `${label}: ${segments.map((segment) =>
            `${segment.label}, ${numberFormat.format(segment.votes)} votos, ${shareText(segment.votes, round.validVotes)}`,
          ).join('; ')}. Referência fixa: 50% dos votos válidos.`
          : `${label}: ${unavailable}`}
        aria-describedby={descriptionId}
      >
        <div className="results-stack-segments" aria-hidden="true">
          {available && segments.map((segment) => (
            <div
              key={segment.id}
              className="results-stack-segment"
              data-candidate-id={segment.id}
              style={{
                width: `${segment.votes / round.validVotes * 100}%`,
                backgroundColor: segment.color,
              }}
            />
          ))}
        </div>
        <span className="results-midpoint" aria-hidden="true" />
      </div>
      <ul className="results-stack-labels" aria-label={`Valores do ${label.toLowerCase()}`}>
        {segments.map((segment) => (
          <li key={segment.id}>
            <span className="results-swatch" style={{ backgroundColor: segment.color }} aria-hidden="true" />
            <span>{segment.label}</span>
            <strong>{shareText(segment.votes, round.validVotes)}</strong>
            <span className="results-muted">{numberFormat.format(segment.votes)} votos</span>
          </li>
        ))}
      </ul>
      {!available && <p className="results-muted">{unavailable}</p>}
    </figure>
  )
}

function RoundDetails({ round, label }: { round: ComparisonRound; label: string }) {
  const timeRange = round.sourceTimes.oldest !== round.sourceTimes.latest
  const completeCoverage = round.coverage.received === round.coverage.expected
  return (
    <section className="results-round-details" aria-label={`Fonte e cédulas do ${label.toLowerCase()}`}>
      <h4>{label}</h4>
      <dl className="results-secondary-values">
        <div><dt>Total de votos</dt><dd>{numberFormat.format(round.totalVotes)}</dd></div>
        <div>
          <dt>Em branco</dt>
          <dd>{numberFormat.format(round.blankVotes)} <span>({shareText(round.blankVotes, round.totalVotes)} do total)</span></dd>
        </div>
        <div>
          <dt>Nulos</dt>
          <dd>{numberFormat.format(round.nullVotes)} <span>({shareText(round.nullVotes, round.totalVotes)} do total)</span></dd>
        </div>
        <div>
          <dt>Situação na fonte</dt>
          <dd>{round.countingComplete ? 'Apuração concluída na fonte' : 'Apuração não concluída na fonte'}</dd>
        </div>
        <div>
          <dt>Seções contabilizadas</dt>
          <dd>{numberFormat.format(round.sections.counted)} de {numberFormat.format(round.sections.total)}</dd>
        </div>
        <div>
          <dt>{timeRange ? 'Intervalo de atualização na fonte' : 'Atualização na fonte'}</dt>
          <dd>
            <Timestamp value={round.sourceTimes.oldest} />
            {timeRange && <> até <Timestamp value={round.sourceTimes.latest} /></>}
          </dd>
        </div>
        <div className={completeCoverage ? undefined : 'results-coverage-warning'}>
          <dt>Cobertura</dt>
          <dd>
            {numberFormat.format(round.coverage.received)} de {numberFormat.format(round.coverage.expected)} fontes recebidas.
            {!completeCoverage && ' Cobertura incompleta: os totais não representam todas as fontes esperadas.'}
          </dd>
        </div>
      </dl>
      {round.totalVotes === 0 && <p className="results-muted">Sem votos contabilizados: percentuais indisponíveis (—).</p>}
    </section>
  )
}

export function ResultsPanel({ comparison, finalists, elections }: ResultsPanelProps) {
  const headingId = useId()
  const tableHintId = useId()
  const absoluteDescriptionId = useId()
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'number', direction: 'ascending',
  })
  const candidates = [...finalists].sort(candidateOrder)
  const missing = [comparison.first, comparison.second].some((round) =>
    candidates.some((candidate) => !Number.isSafeInteger(round.votes[candidate.id])))
  if (missing) {
    return (
      <section className="results-panel results-card" aria-labelledby={headingId}>
        <h2 id={headingId}>Comparação entre turnos indisponível</h2>
        <p>Faltam contagens de finalistas. Dados ausentes não são tratados como zero.</p>
      </section>
    )
  }
  let validationError: string | null = null
  try {
    validateRoundComparison(comparison, candidates, elections)
  } catch (error) {
    if (!(error instanceof ResultDataError)) throw error
    validationError = error.message
  }
  const totals = validationError === null ? validVoteComparison(comparison) : {
    firstVotes: comparison.first.validVotes,
    secondVotes: comparison.second.validVotes,
    voteChange: null,
    relativeChange: null,
  }
  const values = new Map<string, CandidateValues>(candidates.map((candidate) => [
    candidate.id,
    validationError === null ? candidateComparison(comparison, candidate.id) : {
      firstVotes: comparison.first.votes[candidate.id]!,
      secondVotes: comparison.second.votes[candidate.id]!,
      firstShare: null, secondShare: null, voteChange: null, percentagePointChange: null,
    },
  ]))
  const rows = [...candidates].sort((a, b) => {
    const aValue = sort.key === 'number' || sort.key === 'name' || sort.key === 'party'
      ? a[sort.key] : values.get(a.id)![sort.key]
    const bValue = sort.key === 'number' || sort.key === 'name' || sort.key === 'party'
      ? b[sort.key] : values.get(b.id)![sort.key]
    if (aValue === null || bValue === null) {
      return aValue === bValue ? candidateOrder(a, b) : aValue === null ? 1 : -1
    }
    const order = typeof aValue === 'string' && typeof bValue === 'string'
      ? collator.compare(aValue, bValue) : Number(aValue) - Number(bValue)
    return (sort.direction === 'ascending' ? order : -order) || candidateOrder(a, b)
  })
  const maximum = Math.max(0, ...[...values.values()].flatMap(({ firstVotes, secondVotes }) =>
    [firstVotes, secondVotes]))

  function sortableHeading(key: SortKey, label: string, numeric = false, description = label) {
    return (
      <th scope="col" aria-sort={sort.key === key ? sort.direction : 'none'} className={numeric ? 'results-number' : undefined}>
        <button type="button" title={description} aria-label={description === label ? label : `${label}: ${description}`} onClick={() => setSort((previous) => ({
          key, direction: previous.key === key && previous.direction === 'ascending' ? 'descending' : 'ascending',
        }))}>
          {label}
          <span aria-hidden="true" className="results-sort-icon">
            {sort.key === key ? (sort.direction === 'ascending' ? '↑' : '↓') : '↕'}
          </span>
        </button>
      </th>
    )
  }

  return (
    <section className="results-panel" aria-labelledby={headingId}>
      <div className="results-card">
        <p className="results-eyebrow">{comparison.geography.label}</p>
        <h2 id={headingId}>Presidente · comparação entre turnos</h2>
        <p className="results-muted results-intro">Eleições {elections.first.year} · dados congelados; datas de atualização da fonte por turno abaixo.</p>
        {validationError !== null && <p role="status" className="results-coverage-warning">Comparação analítica indisponível: {validationError} Variações não são calculadas com dados inválidos ou incompletos.</p>}
        <dl className="results-total-cards">
          <div><dt>Votos válidos · 1º turno</dt><dd>{numberFormat.format(totals.firstVotes)}</dd></div>
          <div><dt>Votos válidos · 2º turno</dt><dd>{numberFormat.format(totals.secondVotes)}</dd></div>
          <div><dt>Variação absoluta de válidos</dt><dd>{signedText(totals.voteChange)}</dd></div>
          <div>
            <dt>Variação relativa de válidos</dt>
            <dd>{signedText(totals.relativeChange, '%')}</dd>
            <p className="results-muted">{totals.firstVotes === 0 ? 'Base do 1º turno igual a zero: variação relativa indisponível.' : 'Em relação ao total válido do 1º turno.'}</p>
          </div>
        </dl>
      </div>

      <section className="results-card" aria-label="Participação nos votos válidos por turno">
        <h3>Participação nos votos válidos</h3>
        <p className="results-muted">Cada barra usa o total válido do próprio turno. A referência fixa de 50% indica participação, não avanço da apuração ou transferência de votos.</p>
        <RoundStack round={comparison.first} finalists={candidates} label="1º turno" date={elections.first.date} showOthers />
        <RoundStack round={comparison.second} finalists={candidates} label="2º turno" date={elections.second.date} showOthers={false} />
      </section>

      <section className="results-card" aria-label="Votos absolutos dos finalistas">
        <h3>Votos absolutos dos finalistas</h3>
        <p className="results-muted" id={absoluteDescriptionId}>
          Escala única desde zero até {numberFormat.format(maximum)} votos, compartilhada pelas quatro barras.
          1º turno: preenchimento listrado; 2º turno: preenchimento sólido.
        </p>
        <div className="results-absolute-scale" aria-hidden="true"><span>0</span><span>{numberFormat.format(maximum)}</span></div>
        <ul className="results-absolute-candidates">
          {candidates.map((candidate) => {
            const candidateValues = values.get(candidate.id)!
            return (
              <li key={candidate.id}>
                <h4><span className="results-candidate-number" style={{ backgroundColor: candidateColor(candidate) }}>{candidate.number}</span> {candidate.name} · {candidate.party}</h4>
                {(['first', 'second'] as const).map((round) => {
                  const count = candidateValues[round === 'first' ? 'firstVotes' : 'secondVotes']
                  const label = round === 'first' ? '1º turno' : '2º turno'
                  return (
                    <div className="results-absolute-row" key={round}>
                      <div className="results-absolute-label"><span>{label}</span><strong>{numberFormat.format(count)} votos</strong></div>
                      <div
                        className="results-absolute-track"
                        role="img"
                        aria-label={`${candidate.name}, ${label}: ${numberFormat.format(count)} votos. Escala de zero a ${numberFormat.format(maximum)} votos.`}
                        aria-describedby={absoluteDescriptionId}
                      >
                        <div
                          className="results-absolute-bar"
                          data-candidate-id={candidate.id}
                          data-round={round}
                          style={{ width: `${maximum === 0 ? 0 : count / maximum * 100}%`, backgroundColor: candidateColor(candidate) }}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  )
                })}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="results-card" aria-label="Comparação numérica das candidaturas">
        <h3>Comparação das candidaturas</h3>
        <p className="results-muted" id={tableHintId}>
          Use os botões dos cabeçalhos para ordenar. Percentuais usam os votos válidos de cada turno.
          1º e 2º indicam os turnos; Dif. indica a diferença entre o 2º e o 1º turno.
          A diferença de participações é expressa em pontos percentuais (pp), não em variação relativa (%).
          Outros reúne as demais candidaturas do 1º turno e permanece na última linha, sem comparação com o 2º turno.
          Em telas pequenas, deslize a tabela horizontalmente.
        </p>
        <div className="results-table-scroll" role="region" aria-label="Tabela de votos por candidatura" aria-describedby={tableHintId} tabIndex={0}>
          <table className="results-table">
            <caption>Comparação de votos por candidatura</caption>
            <thead>
              <tr>
                {sortableHeading('number', 'Nº', false, 'Número')}
                {sortableHeading('name', 'Nome')}
                {sortableHeading('party', 'Partido')}
                {sortableHeading('firstVotes', 'Votos · 1º', true, 'Votos no 1º turno')}
                {sortableHeading('firstShare', '% · 1º', true, 'Percentual dos votos válidos no 1º turno')}
                {sortableHeading('secondVotes', 'Votos · 2º', true, 'Votos no 2º turno')}
                {sortableHeading('secondShare', '% · 2º', true, 'Percentual dos votos válidos no 2º turno')}
                {sortableHeading('voteChange', 'Dif. votos', true, 'Variação de votos')}
                {sortableHeading('percentagePointChange', 'Dif. (pp)', true, 'Variação em pontos percentuais')}
              </tr>
            </thead>
            <tbody>
              {rows.map((candidate) => {
                const value = values.get(candidate.id)!
                return (
                  <tr key={candidate.id}>
                    <td><span className="results-candidate-number" style={{ backgroundColor: candidateColor(candidate) }}>{candidate.number}</span></td>
                    <th scope="row">{candidate.name}</th>
                    <td>{candidate.party}</td>
                    <td className="results-number">{numberFormat.format(value.firstVotes)}</td>
                    <td className="results-number">{percentText(value.firstShare)}</td>
                    <td className="results-number">{numberFormat.format(value.secondVotes)}</td>
                    <td className="results-number">{percentText(value.secondShare)}</td>
                    <td className="results-number">{signedText(value.voteChange)}</td>
                    <td className="results-number">{signedText(value.percentagePointChange, 'pp')}</td>
                  </tr>
                )
              })}
              <tr>
                <td>—</td>
                <th scope="row">Outros</th>
                <td>—</td>
                <td className="results-number">{numberFormat.format(comparison.first.otherVotes)}</td>
                <td className="results-number">{validationError === null ? shareText(comparison.first.otherVotes, comparison.first.validVotes) : '—'}</td>
                <td className="results-number">—</td>
                <td className="results-number">—</td>
                <td className="results-number">—</td>
                <td className="results-number">—</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="results-disclaimer">Variações agregadas entre turnos não permitem estabelecer transferências de votos de eleitores individuais ou a origem dos ganhos de cada finalista.</p>
      </section>

    </section>
  )
}

export function ResultsProvenance({ comparison }: { comparison: RoundComparison }) {
  return (
    <footer className="results-source-footer">
      <details className="results-card results-provenance">
        <summary>Fonte, cobertura e demais votos</summary>
        <p>Fonte: <a href="https://resultados.tse.jus.br/oficial/app/index.html" target="_blank" rel="noreferrer">Tribunal Superior Eleitoral (TSE)<span className="results-sr-only"> (abre em nova aba)</span></a>.</p>
        <p className="results-muted">Brancos e nulos usam o total de votos, incluindo válidos, brancos e nulos. Horários em America/Sao_Paulo (Brasília).</p>
        <div className="results-round-grid">
          <RoundDetails round={comparison.first} label="1º turno" />
          <RoundDetails round={comparison.second} label="2º turno" />
        </div>
        <p className="results-muted">Localidades podem ter horários de atualização diferentes: os totais agregados não formam um retrato simultâneo. Cobertura de fontes e conclusão da apuração são metadados distintos.</p>
      </details>
    </footer>
  )
}
