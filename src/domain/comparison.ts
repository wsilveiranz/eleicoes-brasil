import type { ElectionMetadata } from './geography'
import {
  aggregateResults, assertCount, percentage, ResultDataError,
  type CandidateResult, type Geography, type ResultSnapshot,
} from './results'

export type Finalist = Pick<CandidateResult, 'id' | 'number' | 'name' | 'party'>

export interface ComparisonRound {
  electionId: string
  validVotes: number
  totalVotes: number
  blankVotes: number
  nullVotes: number
  votes: Record<string, number>
  otherVotes: number
  sections: { total: number; counted: number }
  countingComplete: boolean
  sourceTimes: { oldest: string; latest: string }
  coverage: { received: number; expected: number }
}

export interface RoundComparison {
  geography: Geography
  first: ComparisonRound
  second: ComparisonRound
}

export interface DatasetSummary {
  schemaVersion: 1
  version: string
  generatedAt: string
  metadata: ElectionMetadata
  elections: { first: ElectionMetadata['election']; second: ElectionMetadata['election'] }
  finalists: Finalist[]
  comparisons: RoundComparison[]
}

export interface MunicipalityShard {
  schemaVersion: 1
  version: string
  state: string
  comparisons: RoundComparison[]
}

export interface DatasetResource {
  path: string
  sha256: string
  bytes: number
}

export interface DatasetManifest {
  schemaVersion: 1
  version: string
  generatedAt: string
  summary: DatasetResource
  municipalities: Record<string, DatasetResource>
  provenance: DatasetResource
}

function requireData(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ResultDataError(message)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => assertCount(total + assertCount(value, 'votos'), 'soma'), 0)
}

export function validateFinalists(finalists: readonly Finalist[]): void {
  requireData(finalists.length === 2, 'São necessários exatamente dois finalistas.')
  requireData(new Set(finalists.map(({ id }) => id)).size === 2, 'Finalistas duplicados.')
  requireData(new Set(finalists.map(({ number }) => number)).size === 2, 'Números de finalistas duplicados.')
  for (const finalist of finalists) {
    requireData(
      /^\d+$/.test(finalist.id) && /^\d+$/.test(finalist.number) &&
      finalist.name.trim().length > 0 && finalist.party.trim().length > 0,
      'Identidade de finalista inválida.',
    )
  }
  requireData(Number(finalists[0]!.number) < Number(finalists[1]!.number), 'Ordem de finalistas inválida.')
}

export function validateComparisonRound(round: ComparisonRound, finalistIds: readonly string[]): void {
  requireData(finalistIds.length === 2 && new Set(finalistIds).size === 2,
    'Identidade dos dois finalistas ausente ou duplicada.')
  requireData(round.electionId.length > 0, 'Eleição ausente.')
  for (const value of [
    round.validVotes, round.totalVotes, round.blankVotes, round.nullVotes, round.otherVotes,
    round.sections.total, round.sections.counted, round.coverage.received, round.coverage.expected,
    ...Object.values(round.votes),
  ]) assertCount(value, 'comparação')
  requireData(
    Object.keys(round.votes).length === finalistIds.length &&
    finalistIds.every((id) => Object.hasOwn(round.votes, id)),
    'Identidade de candidato inconsistente.',
  )
  requireData(sum([...Object.values(round.votes), round.otherVotes]) === round.validVotes,
    'Votos dos candidatos e Outros não reconciliam com os votos válidos.')
  requireData(sum([round.validVotes, round.blankVotes, round.nullVotes]) === round.totalVotes,
    'Categorias de votos não reconciliam com o total.')
  requireData(round.countingComplete && round.sections.counted === round.sections.total,
    'Apuração não finalizada.')
  requireData(round.coverage.expected > 0 && round.coverage.received === round.coverage.expected,
    'Cobertura incompleta.')
  const oldest = Date.parse(round.sourceTimes.oldest)
  const latest = Date.parse(round.sourceTimes.latest)
  requireData(Number.isFinite(oldest) && Number.isFinite(latest) && oldest <= latest,
    'Datas da fonte inválidas.')
}

export function validateRoundComparison(
  comparison: RoundComparison,
  finalists: readonly Finalist[],
  elections?: DatasetSummary['elections'],
): void {
  validateFinalists(finalists)
  const ids = finalists.map(({ id }) => id)
  validateComparisonRound(comparison.first, ids)
  validateComparisonRound(comparison.second, ids)
  requireData(comparison.first.electionId !== comparison.second.electionId, 'Os turnos devem ser eleições distintas.')
  requireData(comparison.second.otherVotes === 0, 'O segundo turno contém candidatos além dos finalistas.')
  if (elections) {
    requireData(comparison.first.electionId === elections.first.id &&
      comparison.second.electionId === elections.second.id, 'Identidade dos turnos inconsistente.')
  }
}

/** Input snapshots must already have passed official valid-vote destination validation. */
export function normalizeComparisonRound(
  snapshot: ResultSnapshot,
  finalists: readonly Finalist[],
): ComparisonRound {
  validateFinalists(finalists)
  const candidates = new Map(snapshot.candidates.map((candidate) => [candidate.id, candidate]))
  requireData(candidates.size === snapshot.candidates.length, 'Candidatos duplicados.')
  const votes: Record<string, number> = {}
  for (const finalist of finalists) {
    const candidate = candidates.get(finalist.id)
    requireData(candidate !== undefined && candidate.number === finalist.number &&
      candidate.party === finalist.party, 'Identidade de finalista inconsistente entre turnos.')
    votes[finalist.id] = candidate.votes
  }
  const round: ComparisonRound = {
    electionId: snapshot.electionId,
    validVotes: snapshot.validVotes,
    totalVotes: snapshot.totalVotes,
    blankVotes: snapshot.blankVotes,
    nullVotes: snapshot.nullVotes,
    votes,
    otherVotes: sum(snapshot.candidates.filter(({ id }) => !Object.hasOwn(votes, id)).map(({ votes }) => votes)),
    sections: { ...snapshot.sections },
    countingComplete: snapshot.countingComplete,
    sourceTimes: { ...snapshot.sourceTimes },
    coverage: { ...snapshot.coverage },
  }
  validateComparisonRound(round, finalists.map(({ id }) => id))
  return round
}

export function createRoundComparison(
  first: ResultSnapshot,
  second: ResultSnapshot,
  finalists: readonly Finalist[],
): RoundComparison {
  requireData(first.geography.id === second.geography.id &&
    first.geography.kind === second.geography.kind, 'Localidades diferentes entre turnos.')
  const comparison = {
    geography: { ...second.geography },
    first: normalizeComparisonRound(first, finalists),
    second: normalizeComparisonRound(second, finalists),
  }
  validateRoundComparison(comparison, finalists)
  return comparison
}

/** Aggregate each round before grouping; different same-round candidate sets remain errors. */
export function aggregateComparisonSnapshots(
  geography: Geography,
  expectedIds: readonly string[],
  first: readonly ResultSnapshot[],
  second: readonly ResultSnapshot[],
  finalists: readonly Finalist[],
): RoundComparison {
  for (const snapshot of [...first, ...second]) normalizeComparisonRound(snapshot, finalists)
  return createRoundComparison(
    aggregateResults(geography, expectedIds, first),
    aggregateResults(geography, expectedIds, second),
    finalists,
  )
}

function validatePair(comparison: RoundComparison): void {
  const ids = Object.keys(comparison.first.votes)
  validateComparisonRound(comparison.first, ids)
  validateComparisonRound(comparison.second, ids)
  requireData(comparison.first.electionId !== comparison.second.electionId,
    'Os turnos devem ser eleições distintas.')
  requireData(comparison.second.otherVotes === 0,
    'O segundo turno contém candidatos além dos finalistas.')
}

export function candidateComparison(comparison: RoundComparison, finalistId: string) {
  validatePair(comparison)
  requireData(Object.hasOwn(comparison.first.votes, finalistId), 'Finalista desconhecido.')
  const firstVotes = comparison.first.votes[finalistId]!
  const secondVotes = comparison.second.votes[finalistId]!
  const firstShare = percentage(firstVotes, comparison.first.validVotes)
  const secondShare = percentage(secondVotes, comparison.second.validVotes)
  return {
    firstVotes, secondVotes, firstShare, secondShare,
    voteChange: secondVotes - firstVotes,
    percentagePointChange: firstShare === null || secondShare === null ? null : secondShare - firstShare,
  }
}

export function validVoteComparison(comparison: RoundComparison) {
  validatePair(comparison)
  const firstVotes = comparison.first.validVotes
  const secondVotes = comparison.second.validVotes
  const voteChange = secondVotes - firstVotes
  return {
    firstVotes, secondVotes, voteChange,
    relativeChange: firstVotes === 0 ? null : (voteChange / firstVotes) * 100,
  }
}
