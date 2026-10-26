import { validateRoundComparison, type ComparisonRound, type DatasetSummary } from './comparison'
import { regions } from './regions'
import { assertCount, ResultDataError } from './results'

export const ageGroups = [
  { code: '16-17', label: '16 a 17 anos', sourceCodes: ['1600', '1700'] },
  { code: '18-24', label: '18 a 24 anos', sourceCodes: ['1800', '1900', '2000', '2124'] },
  { code: '25-34', label: '25 a 34 anos', sourceCodes: ['2529', '3034'] },
  { code: '35-44', label: '35 a 44 anos', sourceCodes: ['3539', '4044'] },
  { code: '45-54', label: '45 a 54 anos', sourceCodes: ['4549', '5054'] },
  { code: '55-64', label: '55 a 64 anos', sourceCodes: ['5559', '6064'] },
  { code: '65-69', label: '65 a 69 anos', sourceCodes: ['6569'] },
  { code: '70+', label: '70 anos ou mais', sourceCodes: ['7074', '7579', '8084', '8589', '9094', '9599', '9999'] },
  { code: 'unknown', label: 'Idade desconhecida/inválida', sourceCodes: ['-3'] },
]

export function groupAgeBands(
  bands: readonly { code: string; eligible: number; attended: number; abstained: number }[],
) {
  if (new Set(bands.map(({ code }) => code)).size !== bands.length) {
    throw new ResultDataError('Faixas etárias duplicadas no agrupamento.')
  }
  for (const band of bands) {
    if (!ageGroups.some(({ sourceCodes }) => sourceCodes.includes(band.code))) {
      throw new ResultDataError(`Faixa etária sem agrupamento definido: ${band.code}.`)
    }
  }
  return ageGroups.flatMap((group) => {
    const members = bands.filter(({ code }) => group.sourceCodes.includes(code))
    if (members.length === 0) return []
    const total = (key: 'eligible' | 'attended' | 'abstained') => members.reduce(
      (sum, band) => assertCount(sum + assertCount(band[key], 'perfil etário'), 'soma etária'), 0,
    )
    return [{
      code: group.code, label: group.label,
      eligible: total('eligible'), attended: total('attended'), abstained: total('abstained'),
    }]
  })
}

function comparisonFor(summary: DatasetSummary, id: string) {
  const matches = summary.comparisons.filter(({ geography }) => geography.id === id)
  if (matches.length !== 1) throw new ResultDataError(`Cobertura da localidade incompleta ou duplicada: ${id}.`)
  return matches[0]!
}

export type BallotCounts = Pick<ComparisonRound, 'blankVotes' | 'nullVotes' | 'totalVotes'>

export function blankNullComparisons(summary: DatasetSummary) {
  const localities = [
    { id: 'overall', label: 'Total geral · Brasil e exterior', comparisons: [comparisonFor(summary, 'overall')] },
    ...regions.map(({ id, name, states }) => ({
      id, label: name, comparisons: states.map((state) => comparisonFor(summary, `state:${state}`)),
    })),
  ]
  return localities.map(({ id, label, comparisons }) => {
    for (const comparison of comparisons) validateRoundComparison(comparison, summary.finalists, summary.elections)
    const total = (round: 'first' | 'second'): BallotCounts => {
      const counts = { blankVotes: 0, nullVotes: 0, totalVotes: 0 }
      for (const comparison of comparisons) {
        for (const key of ['blankVotes', 'nullVotes', 'totalVotes'] as const) {
          counts[key] = assertCount(counts[key] + comparison[round][key], 'soma de cédulas')
        }
      }
      return counts
    }
    return { id, label, first: total('first'), second: total('second') }
  })
}

export function regionalVotes(summary: DatasetSummary, round: 'first' | 'second', candidateId: string) {
  if (!summary.finalists.some(({ id }) => id === candidateId)) throw new ResultDataError('Finalista desconhecido.')
  return regions.map((region) => {
    let votes = 0
    for (const state of region.states) {
      const value = comparisonFor(summary, `state:${state}`)[round].votes[candidateId]
      if (value === undefined) throw new ResultDataError('Votos regionais ausentes.')
      votes = assertCount(votes + assertCount(value, 'votos regionais'), 'soma regional')
    }
    return { id: region.id, label: region.name, color: region.color, value: votes }
  })
}
