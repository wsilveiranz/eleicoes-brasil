// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { captureDirectory, pool, reconcileComparisons } from './election-data'
import type { RoundComparison } from '../src/domain/comparison'

function comparison(value: number): RoundComparison {
  const round = {
    electionId: '6257', validVotes: value * 3, totalVotes: value * 5,
    blankVotes: value, nullVotes: value, votes: { lula: value, bolsonaro: value },
    otherVotes: value, sections: { total: value, counted: value }, countingComplete: true,
    sourceTimes: { oldest: '2026-10-26T00:00:00.000Z', latest: '2026-10-26T00:00:00.000Z' },
    coverage: { received: 1, expected: 1 },
  }
  return {
    geography: { id: 'overall', kind: 'overall', label: 'Total geral' },
    first: round, second: structuredClone(round),
  }
}

describe('complete static import gates', () => {
  it('keeps default resume and explicitly named fresh captures in separate cache namespaces', () => {
    expect(captureDirectory()).toMatch(/\.tse-import-cache[\\/]2026$/)
    expect(captureDirectory('correction-2026-11-01')).toMatch(/2026[\\/]captures[\\/]correction-2026-11-01$/)
    expect(captureDirectory('correction-2026-11-01')).toBe(captureDirectory('correction-2026-11-01'))
    expect(captureDirectory('another-capture')).not.toBe(captureDirectory('correction-2026-11-01'))
  })

  it.each(['../escape', '..', '', 'a/b', 'a\\b', 'CON', 'a'.repeat(65)])('rejects unsafe capture namespace %j', (name) => {
    expect(() => captureDirectory(name)).toThrow('Nome de captura inválido')
  })

  it('runs at most four jobs concurrently and waits for all work', async () => {
    let active = 0
    let maximum = 0
    let completed = 0
    await pool(Array.from({ length: 31 }, (_, i) => i), async () => {
      active++
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      completed++
      active--
    })
    expect(maximum).toBe(4)
    expect(completed).toBe(31)
    expect(active).toBe(0)
  })

  it('stops scheduling new jobs after a source failure and awaits active jobs', async () => {
    let completed = 0
    await expect(pool(Array.from({ length: 100 }, (_, i) => i), async (i) => {
      if (i === 0) throw new Error('missing source')
      await new Promise((resolve) => setTimeout(resolve, 1))
      completed++
    })).rejects.toThrow('missing source')
    expect(completed).toBeLessThanOrEqual(3)
  })

  it('reconciles both rounds using integer counts', () => {
    expect(() => reconcileComparisons(comparison(3), [comparison(1), comparison(2)], 'BR')).not.toThrow()
  })

  it.each(['totalVotes', 'validVotes', 'blankVotes', 'nullVotes', 'otherVotes'] as const)(
    'rejects a mismatched %s, never adjusting the source',
    (key) => {
      const parent = comparison(3)
      parent.second[key]++
      expect(() => reconcileComparisons(parent, [comparison(1), comparison(2)], 'BR')).toThrow('reconciliação')
    },
  )

  it('rejects candidate and section discrepancies', () => {
    const parent = comparison(3)
    parent.first.votes.lula = 99
    expect(() => reconcileComparisons(parent, [comparison(1), comparison(2)], 'BR')).toThrow('candidato')
    parent.first.votes.lula = 3
    parent.first.sections.total++
    expect(() => reconcileComparisons(parent, [comparison(1), comparison(2)], 'BR')).toThrow('seções')
  })
})
