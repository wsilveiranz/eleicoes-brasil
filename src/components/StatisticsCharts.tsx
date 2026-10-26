import { useId } from 'react'
import type { Turnout } from '../data/statistics'
import type { BallotCounts } from '../domain/statistics'

export const integer = new Intl.NumberFormat('pt-BR')
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const ratio = (count: number, total: number) => total === 0 ? null : count / total * 100
export const percentage = (value: number | null) => value === null ? '—' : `${decimal.format(value)}%`
export function difference(value: number | null, unit = '') {
  if (value === null) return '—'
  const displayed = Math.abs(value) < .005 ? 0 : value
  return `${displayed > 0 ? '+' : displayed < 0 ? '−' : ''}${unit ? decimal.format(Math.abs(displayed)) : integer.format(Math.abs(displayed))}${unit}`
}
export const timeText = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value))

interface CompositionSegment { id: string; label: string; color: string; value: number }

export const invalidBallotCategories = [
  { key: 'blankVotes', label: 'Brancos', color: '#64748b' },
  { key: 'nullVotes', label: 'Nulos', color: '#715185' },
] as const

export function BlankNullBar({ title, value, maximum }: { title: string; value: BallotCounts; maximum: number }) {
  const total = value.blankVotes + value.nullVotes
  return (
    <figure className="statistics-turnout">
      <figcaption><strong>{title}</strong> · {integer.format(total)} brancos + nulos
        {' '}({percentage(ratio(total, value.totalVotes))} dos votos depositados)</figcaption>
      <div className="statistics-invalid-track" role="img" aria-label={`${title}: ${invalidBallotCategories.map(({ key, label }) =>
        `${label}, ${integer.format(value[key])}, ${percentage(ratio(value[key], value.totalVotes))}`).join('; ')}; ${integer.format(value.totalVotes)} votos depositados`}>
        {maximum > 0 && invalidBallotCategories.map(({ key, label, color }) => (
          <span key={key} data-ballot={key} title={`${label}: ${integer.format(value[key])}`}
            style={{ width: `${value[key] / maximum * 100}%`, backgroundColor: color }} />
        ))}
      </div>
      <ul className="statistics-values">
        {invalidBallotCategories.map(({ key, label, color }) => (
          <li key={key}><span className="statistics-swatch" style={{ backgroundColor: color }} aria-hidden="true" />
            {label}: <strong>{integer.format(value[key])} ({percentage(ratio(value[key], value.totalVotes))})</strong>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function CompositionBar({ title, segments, unit = 'votos' }: { title: string; segments: CompositionSegment[]; unit?: 'votos' | 'comparecimentos' }) {
  const headingId = useId()
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)
  return (
    <figure className="statistics-composition" aria-labelledby={headingId}>
      <figcaption id={headingId}><h4>{title}</h4><p>{integer.format(total)} {unit}</p></figcaption>
      {total === 0 ? <p>Sem {unit}: distribuição indisponível.</p> : (
        <>
          <div className="statistics-composition-track" role="img" aria-label={`${title}: ${segments.map((segment) =>
            `${segment.label}, ${integer.format(segment.value)}, ${percentage(ratio(segment.value, total))}`).join('; ')}`}>
            {segments.filter(({ value }) => value > 0).map((segment) => (
              <span key={segment.id} data-composition={segment.id}
                title={`${segment.label}: ${integer.format(segment.value)} (${percentage(ratio(segment.value, total))})`}
                style={{ width: `${segment.value / total * 100}%`, backgroundColor: segment.color }} />
            ))}
          </div>
          <div className="statistics-composition-scale" aria-hidden="true"><span>0%</span><span>100%</span></div>
        </>
      )}
      <ul className="statistics-values statistics-composition-legend">
        {segments.map((segment) => (
          <li key={segment.id}><span className="statistics-swatch" style={{ backgroundColor: segment.color }} aria-hidden="true" />
            {segment.label}: <strong>{percentage(ratio(segment.value, total))}</strong>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export function ParticipationBar({ title, value }: { title: string; value: Turnout }) {
  const segments = [
    { key: 'attended', label: 'Comparecimento', color: '#276749', count: value.attended },
    { key: 'abstained', label: 'Abstenção', color: '#65717c', count: value.abstained },
    { key: 'unreported', label: 'Sem informação de participação', color: '#a66317', count: value.unreported },
  ]
  return (
    <figure className="statistics-turnout">
      <figcaption><strong>{title}</strong> · {integer.format(value.eligible)} eleitores aptos na fonte</figcaption>
      <div className="statistics-turnout-track" role="img" aria-label={`${title}: ${segments.map((segment) =>
        `${segment.label}, ${integer.format(segment.count)}, ${percentage(ratio(segment.count, value.eligible))}`).join('; ')}`}>
        {value.eligible > 0 && segments.map((segment) => (
          <span key={segment.key} data-participation={segment.key} style={{ width: `${segment.count / value.eligible * 100}%`, backgroundColor: segment.color }} />
        ))}
      </div>
      <ul className="statistics-values">
        {segments.filter((segment) => segment.key !== 'unreported' || segment.count > 0).map((segment) => (
          <li key={segment.key}><span className="statistics-swatch" style={{ backgroundColor: segment.color }} aria-hidden="true" />
            {segment.label}: <strong>{integer.format(segment.count)} ({percentage(ratio(segment.count, value.eligible))})</strong>
          </li>
        ))}
      </ul>
    </figure>
  )
}
