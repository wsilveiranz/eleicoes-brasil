import type { DatasetSummary } from './comparison'
import { regions } from './regions'
import { assertCount, ResultDataError } from './results'

export function regionalVotes(summary: DatasetSummary, round: 'first' | 'second', candidateId: string) {
  if (!summary.finalists.some(({ id }) => id === candidateId)) throw new ResultDataError('Finalista desconhecido.')
  return regions.map((region) => {
    let votes = 0
    for (const state of region.states) {
      const matches = summary.comparisons.filter(({ geography }) => geography.id === `state:${state}`)
      if (matches.length !== 1) throw new ResultDataError('Cobertura estadual incompleta ou duplicada.')
      const value = matches[0]![round].votes[candidateId]
      if (value === undefined) throw new ResultDataError('Votos regionais ausentes.')
      votes = assertCount(votes + assertCount(value, 'votos regionais'), 'soma regional')
    }
    return { id: region.id, label: region.name, color: region.color, value: votes }
  })
}
