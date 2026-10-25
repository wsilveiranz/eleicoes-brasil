export type GeographyKind =
  | 'overall'
  | 'domestic'
  | 'overseas'
  | 'state'
  | 'municipality'
  | 'country'

export interface Geography {
  id: string
  kind: GeographyKind
  label: string
}

export interface CandidateResult {
  id: string
  number: string
  name: string
  party: string
  votes: number
  elected: boolean
}

export interface ResultSnapshot {
  electionId: string
  geography: Geography
  candidates: CandidateResult[]
  validVotes: number
  totalVotes: number
  blankVotes: number
  nullVotes: number
  sections: { total: number; counted: number }
  countingComplete: boolean
  sourceTimes: { oldest: string; latest: string }
  fetchedAt: string
  coverage: { received: number; expected: number }
  constituents?: ResultSnapshot[]
}

export class ResultDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResultDataError'
  }
}

export function assertCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ResultDataError(`Contagem inválida: ${field}.`)
  }
  return value
}

export function percentage(count: number, total: number): number | null {
  assertCount(count, 'quantidade')
  assertCount(total, 'total')
  if (count > total) {
    throw new ResultDataError('A quantidade não pode exceder o total.')
  }
  return total === 0 ? null : (count / total) * 100
}

function sum(values: number[], field: string): number {
  return values.reduce(
    (total, value) => assertCount(total + assertCount(value, field), field),
    0,
  )
}

export function aggregateResults(
  geography: Geography,
  expectedIds: readonly string[],
  snapshots: readonly ResultSnapshot[],
): ResultSnapshot {
  if (expectedIds.length === 0 || new Set(expectedIds).size !== expectedIds.length) {
    throw new ResultDataError('A lista de localidades está vazia ou duplicada.')
  }
  const byId = new Map(snapshots.map((snapshot) => [snapshot.geography.id, snapshot]))
  if (
    byId.size !== snapshots.length ||
    byId.size !== expectedIds.length ||
    expectedIds.some((id) => !byId.has(id))
  ) {
    throw new ResultDataError(
      `Resultados incompletos: ${byId.size} de ${expectedIds.length} localidades.`,
    )
  }
  const first = snapshots[0]
  if (!first) throw new ResultDataError('Nenhum resultado disponível.')
  const candidateIds = new Set(first.candidates.map((candidate) => candidate.id))
  if (candidateIds.size === 0 || candidateIds.size !== first.candidates.length) {
    throw new ResultDataError('Candidatos ausentes ou duplicados.')
  }
  for (const snapshot of snapshots) {
    if (snapshot.electionId !== first.electionId) {
      throw new ResultDataError('Não é possível combinar eleições diferentes.')
    }
    if (
      snapshot.coverage.received !== snapshot.coverage.expected ||
      snapshot.coverage.expected < 1
    ) {
      throw new ResultDataError('Uma localidade possui cobertura incompleta.')
    }
    const ids = new Set(snapshot.candidates.map((candidate) => candidate.id))
    if (
      ids.size !== snapshot.candidates.length ||
      ids.size !== candidateIds.size ||
      [...candidateIds].some((id) => !ids.has(id))
    ) {
      throw new ResultDataError('Os candidatos diferem entre as localidades.')
    }
    if (snapshot.sections.counted > snapshot.sections.total) {
      throw new ResultDataError('O total de seções contabilizadas é inválido.')
    }
    for (const timestamp of [
      snapshot.sourceTimes.oldest,
      snapshot.sourceTimes.latest,
      snapshot.fetchedAt,
    ]) {
      if (!Number.isFinite(Date.parse(timestamp))) {
        throw new ResultDataError('Data de atualização inválida.')
      }
    }
  }
  const candidates = first.candidates.map((candidate) => ({
    ...candidate,
    elected: false,
    votes: sum(
      snapshots.map((snapshot) => {
        const match = snapshot.candidates.find((item) => item.id === candidate.id)
        if (!match || match.number !== candidate.number || match.party !== candidate.party) {
          throw new ResultDataError('Identidade de candidato inconsistente.')
        }
        return match.votes
      }),
      'votos do candidato',
    ),
  }))
  const chronological = (values: string[]) =>
    [...values].sort((a, b) => Date.parse(a) - Date.parse(b))
  const oldest = chronological(snapshots.map((item) => item.sourceTimes.oldest))[0]
  const latest = chronological(snapshots.map((item) => item.sourceTimes.latest)).at(-1)
  const fetchedAt = chronological(snapshots.map((item) => item.fetchedAt)).at(-1)
  if (!oldest || !latest || !fetchedAt) {
    throw new ResultDataError('Datas de atualização ausentes.')
  }
  return {
    electionId: first.electionId,
    geography,
    candidates,
    validVotes: sum(snapshots.map((item) => item.validVotes), 'votos válidos'),
    totalVotes: sum(snapshots.map((item) => item.totalVotes), 'total de votos'),
    blankVotes: sum(snapshots.map((item) => item.blankVotes), 'votos em branco'),
    nullVotes: sum(snapshots.map((item) => item.nullVotes), 'votos nulos'),
    sections: {
      total: sum(snapshots.map((item) => item.sections.total), 'total de seções'),
      counted: sum(snapshots.map((item) => item.sections.counted), 'seções contabilizadas'),
    },
    countingComplete: snapshots.every((item) => item.countingComplete),
    sourceTimes: { oldest, latest },
    fetchedAt,
    coverage: { received: snapshots.length, expected: expectedIds.length },
    constituents: [...snapshots],
  }
}
