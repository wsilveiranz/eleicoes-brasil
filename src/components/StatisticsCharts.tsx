import { useId } from 'react'
import type { Turnout } from '../data/statistics'

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

export interface PieSlice { id: string; label: string; color: string; value: number }

export function PieChart({ title, slices, unit = 'votos' }: { title: string; slices: PieSlice[]; unit?: 'votos' | 'comparecimentos' }) {
  const headingId = useId()
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  let accumulated = 0
  const paths = slices.filter(({ value }) => value > 0).map((slice) => {
    const start = accumulated / total * Math.PI * 2 - Math.PI / 2
    accumulated += slice.value
    const end = accumulated / total * Math.PI * 2 - Math.PI / 2
    const point = (angle: number) => `${60 + 50 * Math.cos(angle)},${60 + 50 * Math.sin(angle)}`
    return {
      ...slice,
      path: `M60,60L${point(start)}A50,50 0 ${slice.value / total > .5 ? 1 : 0} 1 ${point(end)}Z`,
    }
  })
  return (
    <figure className="statistics-pie" aria-labelledby={headingId}>
      <figcaption id={headingId}><h4>{title}</h4><p>{integer.format(total)} {unit}</p></figcaption>
      {total === 0 ? <p>Sem votos: distribuição indisponível.</p> : (
        <svg viewBox="0 0 120 120" role="img" aria-label={`${title}: ${slices.map((slice) =>
          `${slice.label}, ${integer.format(slice.value)}, ${percentage(ratio(slice.value, total))}`).join('; ')}`}>
          {paths.map((slice) => {
            const label = `${slice.label}: ${integer.format(slice.value)} (${percentage(ratio(slice.value, total))})`
            return slice.value === total
              ? <circle key={slice.id} cx="60" cy="60" r="50" fill={slice.color}><title>{label}</title></circle>
              : <path key={slice.id} d={slice.path} fill={slice.color}><title>{label}</title></path>
          })}
        </svg>
      )}
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
