import { useId, useState } from 'react'
import type { CandidateResult, ResultSnapshot } from '../domain/results'
import { percentage } from '../domain/results'
import { candidateColor } from './candidateColors'
import '../styles/results.css'

export interface ResultsPanelProps {
  snapshot: ResultSnapshot
}

type SortKey = 'number' | 'name' | 'party' | 'votes' | 'share'
type SortDirection = 'ascending' | 'descending'

const numberFormat = new Intl.NumberFormat('pt-BR')
const percentFormat = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  dateStyle: 'short',
  timeStyle: 'medium',
})
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

function shareText(count: number, total: number): string {
  const value = percentage(count, total)
  return value === null ? '—' : `${percentFormat.format(value)}%`
}

function candidateOrder(a: CandidateResult, b: CandidateResult): number {
  return collator.compare(a.number, b.number) || collator.compare(a.id, b.id)
}

function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(value))}</time>
}

export function ResultsPanel({ snapshot }: ResultsPanelProps) {
  const headingId = useId()
  const tableHintId = useId()
  const denominatorId = useId()
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'number',
    direction: 'ascending',
  })
  const candidates = [...snapshot.candidates].sort(candidateOrder)
  const rows = [...candidates].sort((a, b) => {
    const comparison =
      sort.key === 'votes' || sort.key === 'share'
        ? a.votes - b.votes
        : collator.compare(a[sort.key], b[sort.key])
    return (sort.direction === 'ascending' ? comparison : -comparison) || candidateOrder(a, b)
  })
  const countingPercent = percentage(snapshot.sections.counted, snapshot.sections.total)
  const aggregate =
    snapshot.geography.kind === 'domestic' ||
    snapshot.geography.kind === 'country' ||
    snapshot.coverage.expected > 1
  const timeRange =
    Date.parse(snapshot.sourceTimes.oldest) !== Date.parse(snapshot.sourceTimes.latest)
  const completeCoverage = snapshot.coverage.received === snapshot.coverage.expected
  const candidateVotes = candidates.reduce((total, candidate) => total + candidate.votes, 0)
  const chartAvailable = snapshot.validVotes > 0 && candidateVotes === snapshot.validVotes
  const highestVotes = Math.max(0, ...candidates.map((candidate) => candidate.votes))
  const leaders = candidates.filter((candidate) => candidate.votes === highestVotes)
  const leader = leaders.length === 1 ? leaders[0] : undefined

  function sortBy(key: SortKey) {
    setSort((previous) => ({
      key,
      direction:
        previous.key === key && previous.direction === 'ascending' ? 'descending' : 'ascending',
    }))
  }

  function sortableHeading(key: SortKey, label: string, numeric = false) {
    return (
      <th
        scope="col"
        aria-sort={sort.key === key ? sort.direction : 'none'}
        className={numeric ? 'results-number' : undefined}
      >
        <button type="button" onClick={() => sortBy(key)}>
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
      <div className="results-card results-overview">
        <div className="results-heading-row">
          <div>
            <p className="results-eyebrow">{snapshot.geography.label}</p>
            <h2 id={headingId}>Votos para presidente</h2>
          </div>
          <span className="results-counting-state">
            {snapshot.countingComplete ? 'Apuração concluída na fonte' : 'Apuração em andamento'}
          </span>
        </div>

        <div className="results-progress-heading">
          <h3>Seções apuradas</h3>
          <strong>{shareText(snapshot.sections.counted, snapshot.sections.total)}</strong>
        </div>
        {countingPercent !== null && (
          <progress
            className="results-progress"
            value={snapshot.sections.counted}
            max={snapshot.sections.total}
            aria-label="Seções apuradas"
          />
        )}
        <p className="results-muted results-progress-detail">
          <strong>{numberFormat.format(snapshot.sections.counted)}</strong> de{' '}
          <strong>{numberFormat.format(snapshot.sections.total)}</strong> seções
          {countingPercent === null && ' · Percentual indisponível: total de seções igual a zero.'}
        </p>

        <div className="results-comparison">
          <h3>Comparação de candidaturas</h3>
          <p id={denominatorId} className="results-muted">
            Percentuais sobre {numberFormat.format(snapshot.validVotes)} votos válidos.
            {snapshot.validVotes === 0 && ' Sem votos válidos: percentuais indisponíveis (—).'}
          </p>
          <figure className="results-stacked-chart">
            <div className="results-stack-scale" aria-hidden="true">
              <span>0%</span><strong>50%</strong><span>100%</span>
            </div>
            <div
              className="results-stack-track"
              role="img"
              aria-label={chartAvailable
                ? `Comparação dos votos válidos: ${candidates.map((candidate) =>
                  `${candidate.name}, ${candidate.party}, ${shareText(candidate.votes, snapshot.validVotes)}`,
                ).join('; ')}. Referência central: 50%.`
                : 'Comparação gráfica indisponível: não há votos válidos ou as contagens não coincidem.'}
              aria-describedby={denominatorId}
            >
              <div className="results-stack-segments" aria-hidden="true">
                {chartAvailable && candidates.map((candidate) => {
                  const share = percentage(candidate.votes, snapshot.validVotes) ?? 0
                  return (
                    <div
                      key={candidate.id}
                      className="results-stack-segment"
                      data-candidate-id={candidate.id}
                      style={{ width: `${share}%`, backgroundColor: candidateColor(candidate) }}
                    >
                      {share >= 35 && <span>{candidate.number} · {shareText(candidate.votes, snapshot.validVotes)}</span>}
                    </div>
                  )
                })}
              </div>
              <span className="results-midpoint" aria-hidden="true" />
            </div>
            <figcaption className="results-muted">
              A marca central indica 50% dos votos válidos, não o avanço da apuração.
              {!chartAvailable && snapshot.validVotes > 0 && ' Gráfico indisponível: as contagens por candidatura diferem do total de votos válidos.'}
            </figcaption>
          </figure>
          {chartAvailable && (
            <p className="results-lead">
              {leader
                ? <>Liderança nos votos apurados: <strong>{leader.name}</strong>.</>
                : 'Empate nos votos contabilizados.'}{' '}
              A liderança não é uma declaração de eleição.
            </p>
          )}
          <ul className="results-candidates" aria-describedby={denominatorId}>
            {candidates.map((candidate) => (
              <li key={candidate.id} className="results-candidate" style={{ borderColor: candidateColor(candidate) }}>
                <div className="results-candidate-heading">
                  <div className="results-candidate-identity">
                    <span className="results-candidate-number" style={{ backgroundColor: candidateColor(candidate) }}>{candidate.number}</span>
                    <div>
                      <strong className="results-candidate-name">{candidate.name}</strong>
                      <span className="results-muted">{candidate.party}</span>
                    </div>
                    {candidate.elected && <span className="results-elected">Eleito(a) · TSE</span>}
                  </div>
                  <div className="results-candidate-values">
                    <strong style={{ color: candidateColor(candidate) }}>{shareText(candidate.votes, snapshot.validVotes)}</strong>
                    <span>{numberFormat.format(candidate.votes)} votos</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {candidates.length === 0 && <p>Nenhuma candidatura informada pela fonte.</p>}
        </div>
      </div>

      <div className="results-card results-table-card">
        <h3>Resultados em números</h3>
        <p className="results-muted" id={tableHintId}>
          Use os botões nos cabeçalhos para ordenar. Em telas pequenas, deslize a tabela
          horizontalmente.
        </p>
        <div
          className="results-table-scroll"
          role="region"
          aria-label="Tabela de votos por candidatura"
          aria-describedby={tableHintId}
          tabIndex={0}
        >
          <table className="results-table">
            <caption>Votos por candidatura · percentuais dos votos válidos</caption>
            <thead>
              <tr>
                {sortableHeading('number', 'Número')}
                {sortableHeading('name', 'Nome')}
                {sortableHeading('party', 'Partido')}
                {sortableHeading('votes', 'Votos', true)}
                {sortableHeading('share', '% dos válidos', true)}
              </tr>
            </thead>
            <tbody>
              {rows.map((candidate) => (
                <tr key={candidate.id}>
                  <td><span className="results-candidate-number" style={{ backgroundColor: candidateColor(candidate) }}>{candidate.number}</span></td>
                  <th scope="row">
                    {candidate.name}
                    {candidate.elected && <span className="results-elected">Eleito(a) · TSE</span>}
                  </th>
                  <td>{candidate.party}</td>
                  <td className="results-number">{numberFormat.format(candidate.votes)}</td>
                  <td className="results-number">{shareText(candidate.votes, snapshot.validVotes)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>Total de votos válidos</th>
                <td className="results-number">{numberFormat.format(snapshot.validVotes)}</td>
                <td className="results-number">{shareText(snapshot.validVotes, snapshot.validVotes)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="results-card">
        <h3>Além dos votos válidos</h3>
        <p className="results-muted">
          Brancos e nulos: percentuais sobre o total de votos, incluindo válidos, brancos e nulos.
        </p>
        <dl className="results-ballot-totals">
          <div>
            <dt>Total de votos</dt>
            <dd>{numberFormat.format(snapshot.totalVotes)}</dd>
          </div>
          <div>
            <dt>Em branco</dt>
            <dd>
              {numberFormat.format(snapshot.blankVotes)}
              <span>{shareText(snapshot.blankVotes, snapshot.totalVotes)} do total de votos</span>
            </dd>
          </div>
          <div>
            <dt>Nulos</dt>
            <dd>
              {numberFormat.format(snapshot.nullVotes)}
              <span>{shareText(snapshot.nullVotes, snapshot.totalVotes)} do total de votos</span>
            </dd>
          </div>
        </dl>
        {snapshot.totalVotes === 0 && (
          <p className="results-muted">Sem votos contabilizados: percentuais de brancos e nulos indisponíveis (—).</p>
        )}
      </div>

      <footer className="results-card results-provenance">
        <h3>Fonte e cobertura</h3>
        <p>
          Fonte: <a href="https://resultados.tse.jus.br/oficial/app/index.html" target="_blank" rel="noreferrer">
            Tribunal Superior Eleitoral (TSE)<span className="results-sr-only"> (abre em nova aba)</span>
          </a>.
        </p>
        <dl className="results-source-times">
          <div>
            <dt>{timeRange ? 'Intervalo de atualização na fonte' : 'Atualização na fonte'}</dt>
            <dd>
              <Timestamp value={snapshot.sourceTimes.oldest} />
              {timeRange && <> até <Timestamp value={snapshot.sourceTimes.latest} /></>}
            </dd>
          </div>
          <div>
            <dt>Consulta aos dados</dt>
            <dd><Timestamp value={snapshot.fetchedAt} /></dd>
          </div>
        </dl>
        <p className="results-muted">Todos os horários em America/Sao_Paulo (horário de Brasília).</p>
        <p className={completeCoverage ? undefined : 'results-coverage-warning'}>
          Cobertura: <strong>{numberFormat.format(snapshot.coverage.received)} de{' '}
            {numberFormat.format(snapshot.coverage.expected)}</strong> fontes recebidas.
          {!completeCoverage && ' Cobertura incompleta: os totais não representam todas as fontes esperadas.'}
        </p>
        {aggregate && (
          <p className="results-muted">
            Agregação de resultados de localidades: as fontes podem ser atualizadas em horários
            diferentes e não formam um retrato simultâneo. Percentuais são calculados sobre a soma
            dos votos; a cobertura não indica o avanço da apuração.
          </p>
        )}
        <p className="results-muted">
          Uma vantagem em votos não declara uma pessoa eleita. A indicação “Eleito(a)” aparece
          somente quando informada pela fonte; a conclusão da apuração é um dado separado.
        </p>
      </footer>
    </section>
  )
}
