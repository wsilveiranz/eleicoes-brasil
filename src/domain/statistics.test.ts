import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DatasetManifest, DatasetSummary } from './comparison'
import { regionalVotes } from './statistics'
import { regions } from './regions'

const manifest: DatasetManifest = JSON.parse(readFileSync('public/data/2026/manifest.json', 'utf8'))
const summary: DatasetSummary = JSON.parse(readFileSync(`public/data/2026/${manifest.summary.path}`, 'utf8'))

describe('regional candidate distributions', () => {
  it('partitions exactly the 27 Brazilian UFs without overseas and reconciles each candidate/round', () => {
    const states = regions.flatMap(({ states }) => [...states])
    expect(states).toHaveLength(27)
    expect(new Set(states).size).toBe(27)
    for (const round of ['first', 'second'] as const) for (const candidate of summary.finalists) {
      const values = regionalVotes(summary, round, candidate.id)
      expect(values.reduce((sum, slice) => sum + slice.value, 0)).toBe(
        summary.comparisons.find(({ geography }) => geography.id === 'domestic')![round].votes[candidate.id],
      )
      for (const [index, region] of regions.entries()) {
        expect(values[index]!.value).toBe(region.states.reduce((sum, state) => sum +
          summary.comparisons.find(({ geography }) => geography.id === `state:${state}`)![round].votes[candidate.id]!, 0))
      }
    }
  })

  it('rejects absent or duplicated UF results and unknown candidates instead of creating partial pies', () => {
    const withoutSp = { ...summary, comparisons: summary.comparisons.filter(({ geography }) => geography.id !== 'state:sp') }
    expect(() => regionalVotes(withoutSp, 'first', summary.finalists[0]!.id)).toThrow(/Cobertura/)
    expect(() => regionalVotes({ ...summary, comparisons: [...summary.comparisons, summary.comparisons.find(({ geography }) => geography.id === 'state:sp')!] }, 'second', summary.finalists[0]!.id)).toThrow(/duplicada/)
    expect(() => regionalVotes(summary, 'first', 'unknown')).toThrow(/Finalista/)
  })
})
