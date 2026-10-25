import { describe, expect, it } from 'vitest'
import { aggregateResults, percentage, type ResultSnapshot } from './results'

function snapshot(id: string, votes: [number, number]): ResultSnapshot {
  return {
    electionId: '6258',
    geography: { id, kind: 'state', label: id.toUpperCase() },
    candidates: [
      { id: 'a', number: '10', name: 'A', party: 'AA', votes: votes[0], elected: false },
      { id: 'b', number: '20', name: 'B', party: 'BB', votes: votes[1], elected: false },
    ],
    validVotes: votes[0] + votes[1],
    totalVotes: votes[0] + votes[1] + 2,
    blankVotes: 1,
    nullVotes: 1,
    sections: { total: 10, counted: 5 },
    countingComplete: false,
    sourceTimes: {
      oldest: '2026-10-25T19:00:00-03:00',
      latest: '2026-10-25T19:00:00-03:00',
    },
    fetchedAt: '2026-10-25T22:01:00Z',
    coverage: { received: 1, expected: 1 },
  }
}

const domestic = { id: 'domestic', kind: 'domestic', label: 'Brasil' } as const

describe('percentage', () => {
  it('uses the selected denominator and preserves a zero denominator as unavailable', () => {
    expect(percentage(25, 200)).toBe(12.5)
    expect(percentage(0, 0)).toBeNull()
    expect(percentage(0, 100)).toBe(0)
  })

  it('rejects unsafe or impossible counts', () => {
    for (const value of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => percentage(value, 100)).toThrow()
    }
    expect(() => percentage(101, 100)).toThrow()
  })
})

describe('aggregateResults', () => {
  it('joins candidates by identity and sums counts before calculating percentages', () => {
    const sp = snapshot('sp', [90, 10])
    const df = snapshot('df', [1, 9])
    df.candidates.reverse()
    df.sourceTimes.latest = '2026-10-25T19:02:00-03:00'
    const result = aggregateResults(domestic, ['sp', 'df'], [df, sp])
    expect(result.validVotes).toBe(110)
    expect(result.candidates.find((item) => item.id === 'a')?.votes).toBe(91)
    expect(percentage(91, result.validVotes)).toBeCloseTo(82.7272727)
    expect(result.sections).toEqual({ total: 20, counted: 10 })
    expect(result.coverage).toEqual({ received: 2, expected: 2 })
    expect(result.sourceTimes.latest).toBe(df.sourceTimes.latest)
  })

  it('requires the complete unique child set, preventing silently partial totals', () => {
    const sp = snapshot('sp', [1, 2])
    expect(() => aggregateResults(domestic, ['sp', 'df'], [sp])).toThrow(/incompletos/)
    expect(() => aggregateResults(domestic, ['sp'], [sp, sp])).toThrow()
    expect(() => aggregateResults(domestic, ['sp', 'sp'], [sp])).toThrow()
    expect(() => aggregateResults(domestic, ['df'], [sp])).toThrow()
    expect(() => aggregateResults(domestic, [], [])).toThrow()
  })

  it('rejects mixed elections, candidates, and incomplete child coverage', () => {
    const sp = snapshot('sp', [1, 2])
    const df = snapshot('df', [3, 4])
    df.electionId = 'other'
    expect(() => aggregateResults(domestic, ['sp', 'df'], [sp, df])).toThrow(/eleições/)
    df.electionId = sp.electionId
    df.candidates.pop()
    expect(() => aggregateResults(domestic, ['sp', 'df'], [sp, df])).toThrow(/candidatos/)
    const incomplete = snapshot('df', [3, 4])
    incomplete.coverage = { received: 1, expected: 2 }
    expect(() => aggregateResults(domestic, ['sp', 'df'], [sp, incomplete])).toThrow(/cobertura/)
  })

  it('does not turn a local lead or election status into an aggregate winner', () => {
    const local = snapshot('sp', [2, 1])
    local.candidates[0]!.elected = true
    expect(aggregateResults(domestic, ['sp'], [local]).candidates[0]?.elected).toBe(false)
  })

  it('rejects invalid timestamps and numeric overflow', () => {
    const invalid = snapshot('sp', [1, 2])
    invalid.sourceTimes.oldest = 'not a date'
    expect(() => aggregateResults(domestic, ['sp'], [invalid])).toThrow(/Data/)
    const huge = snapshot('sp', [Number.MAX_SAFE_INTEGER, 0])
    expect(() => aggregateResults(domestic, ['sp', 'df'], [huge, snapshot('df', [1, 0])]))
      .toThrow(/Contagem/)
  })
})
