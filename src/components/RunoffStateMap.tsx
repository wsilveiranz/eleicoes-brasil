import { useId } from 'react'
import boundaries from '../data/geography/brazil-states.json'
import {
  validateComparisonRound, type Finalist, type RoundComparison,
} from '../domain/comparison'
import type { ElectionMetadata } from '../domain/geography'
import { ResultDataError } from '../domain/results'
import { selectionSearch } from '../domain/selection'
import { navigate } from '../hooks/useSelection'
import { candidateColor } from './candidateColors'
import '../styles/state-map.css'

const neutral = '#65717c'
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function stateResult(comparison: RoundComparison | undefined, finalists: Finalist[], electionId: string) {
  if (!comparison) return { label: 'Resultado indisponível', winner: undefined }
  const round = comparison.second
  try {
    validateComparisonRound(round, finalists.map(({ id }) => id))
    if (round.electionId !== electionId || round.otherVotes !== 0) {
      throw new ResultDataError('Identidade do segundo turno inconsistente')
    }
  } catch (error) {
    if (!(error instanceof ResultDataError)) throw error
    return { label: `Resultado indisponível: ${error.message}`, winner: undefined }
  }
  if (round.validVotes === 0) return { label: 'Sem votos válidos', winner: undefined }
  const ordered = [...finalists].sort((a, b) => round.votes[b.id]! - round.votes[a.id]!)
  if (round.votes[ordered[0]!.id] === round.votes[ordered[1]!.id]) {
    return { label: 'Empate nos votos válidos', winner: undefined }
  }
  const winner = ordered[0]!
  return {
    winner,
    label: `Mais votado: ${winner.name} · ${winner.party}, ${percent.format(round.votes[winner.id]! / round.validVotes * 100)}% dos válidos`,
  }
}

export function RunoffStateMap({
  metadata, comparisons, finalists,
}: {
  metadata: ElectionMetadata
  comparisons: RoundComparison[]
  finalists: Finalist[]
}) {
  const headingId = useId()
  const hintId = useId()
  const byId = new Map(comparisons.map((comparison) => [comparison.geography.id, comparison]))
  const states = boundaries.states.map((state) => ({
    ...state,
    name: metadata.states.find(({ code }) => code === state.code)?.name ?? state.name,
    result: stateResult(byId.get(`state:${state.code}`), finalists, metadata.election.id),
  }))
  return (
    <section className="state-map-card" aria-labelledby={headingId}>
      <h2 id={headingId}>Mais votado por estado · 2º turno</h2>
      <p id={hintId}>Cores indicam a candidatura mais votada em cada UF, apenas no segundo turno.
        Selecione um estado ou sua sigla para comparar os turnos. Empate ou resultado indisponível: cinza.</p>
      <ul className="state-map-legend" aria-label="Legenda do mapa">
        {finalists.map((candidate) => (
          <li key={candidate.id}>
            <span style={{ backgroundColor: candidateColor(candidate) }} aria-hidden="true" />
            {candidate.name} · {candidate.party}
          </li>
        ))}
        <li><span style={{ backgroundColor: neutral }} aria-hidden="true" />Empate / indisponível</li>
      </ul>
      <svg className="state-map" viewBox={boundaries.viewBox} role="group" aria-label="Mapa do Brasil por UF" aria-describedby={hintId}>
        {states.map((state) => {
          const selection = { scope: 'domestic', state: state.code } as const
          return (
            <a
              key={state.code}
              href={selectionSearch(selection)}
              role="link"
              tabIndex={0}
              aria-label={`${state.name} (${state.code.toUpperCase()}) · 2º turno. ${state.result.label}. Abrir comparação.`}
              data-state={state.code}
              data-winner={state.result.winner?.id ?? 'neutral'}
              onClick={(event) => {
                if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                navigate(selection)
              }}
            >
              <title>{state.name}: {state.result.label}</title>
              <path d={state.path} fill={state.result.winner ? candidateColor(state.result.winner) : neutral} fillRule="evenodd" />
            </a>
          )
        })}
        {states.map((state) => (
          <g key={state.code} className="state-map-label" aria-hidden="true">
            {(state.center[0] !== state.label[0] || state.center[1] !== state.label[1]) && (
              <line x1={state.center[0]} y1={state.center[1]} x2={state.label[0]} y2={state.label[1]} />
            )}
            <text x={state.label[0]} y={state.label[1]}>{state.code.toUpperCase()}</text>
          </g>
        ))}
      </svg>
      <nav className="state-map-links" aria-label="Alternativa ao mapa: selecionar UF">
        {states.map((state) => {
          const selection = { scope: 'domestic', state: state.code } as const
          return (
            <a
              key={state.code}
              href={selectionSearch(selection)}
              title={`${state.name}: ${state.result.label}`}
              aria-label={`${state.name}: ${state.result.label}`}
              onClick={(event) => {
                if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                navigate(selection)
              }}
            >
              <span style={{ backgroundColor: state.result.winner ? candidateColor(state.result.winner) : neutral }} aria-hidden="true" />
              {state.code.toUpperCase()}
            </a>
          )
        })}
      </nav>
      <p className="state-map-source">
        Votos: TSE, resultados finais do 2º turno. Malha: <a href={boundaries.source}>IBGE, UFs {boundaries.edition}</a>, simplificada para visualização.
        As siglas têm links alternativos, inclusive para o Distrito Federal.
      </p>
    </section>
  )
}
