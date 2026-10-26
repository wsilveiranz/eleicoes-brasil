import { describe, expect, it } from 'vitest'
import {
  aggregateComparisonSnapshots, candidateComparison, createRoundComparison,
  normalizeComparisonRound, validateRoundComparison, validVoteComparison, type Finalist,
} from './comparison'
import type { ResultSnapshot } from './results'

const finalists: Finalist[] = [
  { id: '100', number: '13', name: 'A', party: 'PT' },
  { id: '200', number: '22', name: 'B', party: 'PL' },
]

function snapshot(electionId: string, a = 1, b = 1, other = 0, id = 'state:sp'): ResultSnapshot {
  return {
    electionId, geography: { id, kind: 'state', label: id },
    candidates: [
      ...finalists.map((candidate, index) => ({ ...candidate, votes: index === 0 ? a : b, elected: false })),
      ...(other ? [{ id: '300', number: '30', name: 'C', party: 'CC', votes: other, elected: false }] : []),
    ],
    validVotes: a + b + other, totalVotes: a + b + other + 2, blankVotes: 1, nullVotes: 1,
    sections: { total: 5, counted: 5 }, countingComplete: true,
    sourceTimes: { oldest: '2026-10-25T20:00:00Z', latest: '2026-10-25T21:00:00Z' },
    fetchedAt: '2026-10-26T01:00:00Z', coverage: { received: 1, expected: 1 },
  }
}

describe('completed two-round comparisons', () => {
  it('matches canonical IDs despite source ordering, and groups exact eligible other counts', () => {
    const first = snapshot('6257', 10, 20, 30)
    first.candidates.reverse()
    const second = snapshot('6258', 35, 25)
    const comparison = createRoundComparison(first, second, finalists)
    expect(comparison.first.votes).toEqual({ '100': 10, '200': 20 })
    expect(comparison.first.otherVotes).toBe(30)
    expect(comparison.second.otherVotes).toBe(0)
    expect(first.candidates).toHaveLength(3)
  })

  it('uses each round denominator and unrounded signed percentage-point changes', () => {
    const comparison = createRoundComparison(snapshot('6257', 1, 2, 4), snapshot('6258', 2, 1), finalists)
    const result = candidateComparison(comparison, '100')
    expect(result).toEqual({
      firstVotes: 1, secondVotes: 2, firstShare: (1 / 7) * 100, secondShare: (2 / 3) * 100,
      voteChange: 1, percentagePointChange: (2 / 3) * 100 - (1 / 7) * 100,
    })
    expect(validVoteComparison(comparison)).toEqual({
      firstVotes: 7, secondVotes: 3, voteChange: -4, relativeChange: (-4 / 7) * 100,
    })
    expect(candidateComparison(comparison, '200').voteChange).toBe(-1)
  })

  it('retains zero-denominator shares and zero-baseline relative growth as unavailable', () => {
    const comparison = createRoundComparison(snapshot('6257', 0, 0), snapshot('6258', 0, 1), finalists)
    expect(candidateComparison(comparison, '100')).toMatchObject({
      firstShare: null, secondShare: 0, percentagePointChange: null, voteChange: 0,
    })
    expect(validVoteComparison(comparison).relativeChange).toBeNull()
    const zero = createRoundComparison(snapshot('6257', 0, 0), snapshot('6258', 0, 0), finalists)
    expect(candidateComparison(zero, '100').secondShare).toBeNull()
    expect(validVoteComparison(zero).voteChange).toBe(0)
  })

  it('rejects missing, duplicate, remapped and party/number-inconsistent finalists', () => {
    for (const mutate of [
      (value: ResultSnapshot) => { value.candidates.pop() },
      (value: ResultSnapshot) => { value.candidates.push({ ...value.candidates[0]! }) },
      (value: ResultSnapshot) => { value.candidates[0]!.id = '999' },
      (value: ResultSnapshot) => { value.candidates[0]!.party = 'OTHER' },
      (value: ResultSnapshot) => { value.candidates[0]!.number = '99' },
    ]) {
      const value = snapshot('6257')
      mutate(value)
      expect(() => normalizeComparisonRound(value, finalists)).toThrow()
    }
    expect(() => normalizeComparisonRound(snapshot('6257'), [...finalists].reverse())).toThrow()
  })

  it('rejects invalid counts, nonfinal/incomplete coverage, timestamps and unreconciled categories', () => {
    for (const mutate of [
      (value: ResultSnapshot) => { value.candidates[0]!.votes = -1 },
      (value: ResultSnapshot) => { value.candidates[0]!.votes = 0.5 },
      (value: ResultSnapshot) => { value.validVotes++ },
      (value: ResultSnapshot) => { value.totalVotes++ },
      (value: ResultSnapshot) => { value.countingComplete = false },
      (value: ResultSnapshot) => { value.sections.counted-- },
      (value: ResultSnapshot) => { value.coverage.expected++ },
      (value: ResultSnapshot) => { value.coverage.expected = 0; value.coverage.received = 0 },
      (value: ResultSnapshot) => { value.sourceTimes.oldest = 'bad' },
      (value: ResultSnapshot) => { value.sourceTimes.oldest = '2027-01-01T00:00:00Z' },
      (value: ResultSnapshot) => { value.candidates[0]!.votes = Number.MAX_SAFE_INTEGER },
    ]) {
      const value = snapshot('6257')
      mutate(value)
      expect(() => normalizeComparisonRound(value, finalists)).toThrow()
    }
  })

  it('rejects same-election, wrong expected election, geography mismatch and runoff Others', () => {
    expect(() => createRoundComparison(snapshot('6257'), snapshot('6257'), finalists)).toThrow()
    expect(() => createRoundComparison(snapshot('6257'), snapshot('6258', 1, 1, 0, 'state:df'), finalists)).toThrow()
    expect(() => createRoundComparison(snapshot('6257'), snapshot('6258', 1, 1, 1), finalists)).toThrow()
    const comparison = createRoundComparison(snapshot('6257'), snapshot('6258'), finalists)
    expect(() => validateRoundComparison(comparison, finalists, {
      first: { id: 'wrong' }, second: { id: '6258' },
    } as Parameters<typeof validateRoundComparison>[2])).toThrow()
    expect(() => candidateComparison(comparison, 'unknown')).toThrow()
  })

  it('aggregates strictly within each round before grouping, never relaxing same-round candidates', () => {
    const geography = { id: 'domestic', kind: 'domestic', label: 'Brasil' } as const
    const ids = ['state:sp', 'state:df']
    const first = [snapshot('6257', 1, 2, 3, ids[0]), snapshot('6257', 3, 4, 5, ids[1])]
    const second = [snapshot('6258', 4, 5, 0, ids[0]), snapshot('6258', 6, 7, 0, ids[1])]
    first[1]!.candidates.reverse()
    const comparison = aggregateComparisonSnapshots(geography, ids, first, second, finalists)
    expect(comparison.first.validVotes).toBe(18)
    expect(comparison.first.otherVotes).toBe(8)
    expect(comparison.second.votes['100']).toBe(10)
    expect(comparison.first.coverage).toEqual({ received: 2, expected: 2 })
    first[1]!.candidates[0]!.id = '999'
    expect(() => aggregateComparisonSnapshots(geography, ids, first, second, finalists)).toThrow()
    expect(() => aggregateComparisonSnapshots(geography, ids, first.slice(0, 1), second, finalists)).toThrow()
  })
})
