import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DatasetManifest, DatasetSummary } from './comparison'
import type { AgeData } from '../data/statistics'
import { ageGroups, groupAgeBands, regionalVotes } from './statistics'
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

  describe('coarse age comparisons', () => {
    it('groups every published source band exactly once, preserves unknowns and all counts without changing source data', () => {
      const data: AgeData = JSON.parse(readFileSync('public/data/2026/age-turnout.json', 'utf8'))
      const original = data.first.bands
      const before = structuredClone(original)
      const grouped = groupAgeBands(original)
      expect(grouped.map(({ code }) => code)).toEqual(ageGroups.map(({ code }) => code))
      for (const key of ['eligible', 'attended', 'abstained'] as const) {
        expect(grouped.reduce((sum, band) => sum + band[key], 0)).toBe(
          before.reduce((sum, band) => sum + band[key], 0),
        )
      }
      expect(grouped.find(({ code }) => code === '16-17')!.attended).toBe(539705 + 887283)
      expect(grouped.find(({ code }) => code === '18-24')!.attended).toBe(1681406 + 1811191 + 1952090 + 8067287)
      expect(grouped.find(({ code }) => code === 'unknown')!.attended).toBe(681)
      expect(original).toEqual(before)
    })

    it('keeps missing groups absent and does not invent zero counts for unavailable rounds', () => {
      expect(groupAgeBands([])).toEqual([])
      expect(groupAgeBands([
        { code: '9999', eligible: 100, attended: 10, abstained: 90 },
      ])).toEqual([{ code: '70+', label: '70 anos ou mais', eligible: 100, attended: 10, abstained: 90 }])
    })

    it('rejects unassigned or duplicate source bands instead of dropping or double-counting voters', () => {
      const band = { code: '1600', eligible: 100, attended: 80, abstained: 20 }
      expect(() => groupAgeBands([band, band])).toThrow(/duplicadas/)
      expect(() => groupAgeBands([{ ...band, code: 'new-code' }])).toThrow(/sem agrupamento/)
    })
  })

  it('rejects absent or duplicated UF results and unknown candidates instead of creating partial pies', () => {
    const withoutSp = { ...summary, comparisons: summary.comparisons.filter(({ geography }) => geography.id !== 'state:sp') }
    expect(() => regionalVotes(withoutSp, 'first', summary.finalists[0]!.id)).toThrow(/Cobertura/)
    expect(() => regionalVotes({ ...summary, comparisons: [...summary.comparisons, summary.comparisons.find(({ geography }) => geography.id === 'state:sp')!] }, 'second', summary.finalists[0]!.id)).toThrow(/duplicada/)
    expect(() => regionalVotes(summary, 'first', 'unknown')).toThrow(/Finalista/)
  })
})
