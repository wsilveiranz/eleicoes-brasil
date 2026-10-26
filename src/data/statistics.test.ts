import { describe, expect, it } from 'vitest'
import { parseAgeData, parseParticipation, type AgeData, type ParticipationData } from './statistics'
import { regions } from '../domain/regions'

function participation(): ParticipationData {
  const unit = { eligible: 100, attended: 79, abstained: 20, unreported: 1 }
  const domestic = { eligible: 500, attended: 395, abstained: 100, unreported: 5 }
  const overall = { eligible: 600, attended: 474, abstained: 120, unreported: 6 }
  const round = {
    overall, domestic, overseas: unit,
    regions: Object.fromEntries(regions.map(({ id }) => [id, { ...unit }])),
  }
  return {
    schemaVersion: 1, datasetVersion: 'capture', generatedAt: '2026-10-26T00:00:00Z',
    first: { ...structuredClone(round), electionId: '6257' },
    second: { ...structuredClone(round), electionId: '6258' },
    sources: Array.from({ length: 58 }, (_, index) => ({
      url: `https://resultados.tse.jus.br/oficial/source-${index}.jws`, sha256: 'a'.repeat(64),
    })),
  }
}

export function ageFixture(): AgeData {
  return {
    schemaVersion: 1, year: 2026, checkedAt: '2026-10-26T12:00:00Z', lastSuccessAt: '2026-10-26T12:00:00Z',
    dataUpdatedAt: '2026-10-26T12:00:00Z', refresh: 'ok', error: null, etag: '"source"', lastModified: null,
    source: 'https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_comparecimento_abstencao/perfil_comparecimento_abstencao_2026.zip',
    sha256: 'b'.repeat(64),
    first: {
      status: 'available', sourceGeneratedAt: '2026-10-13T19:46:32Z',
      states: [...regions.flatMap(({ states }) => [...states]), 'zz'].map((state) => state.toUpperCase()),
      bands: [
        { code: '1600', label: '16 anos', eligible: 100, attended: 80, abstained: 20 },
        { code: '7074', label: '70 a 74 anos', eligible: 200, attended: 100, abstained: 100 },
      ],
    },
    second: { status: 'not-published', sourceGeneratedAt: null, states: [], bands: [] },
  }
}

describe('participation data contract', () => {
  it('preserves source electorate and an explicit unreported segment rather than inventing abstention', () => {
    const data = parseParticipation(participation(), 'capture')
    expect(data.first.overall).toEqual({ eligible: 600, attended: 474, abstained: 120, unreported: 6 })
  })

  it('rejects mixed versions, wrong rounds, incomplete regions and unreconciled totals', () => {
    expect(() => parseParticipation(participation(), 'different')).toThrow(/versão/)
    const cases = [
      (data: ParticipationData) => { data.second.electionId = '6257' },
      (data: ParticipationData) => { delete data.first.regions.norte },
      (data: ParticipationData) => { data.first.overall.eligible += 1 },
      (data: ParticipationData) => { data.first.domestic.attended -= 1; data.first.domestic.abstained += 1 },
      (data: ParticipationData) => { data.sources[1] = data.sources[0]! },
    ]
    for (const mutate of cases) {
      const data = participation()
      mutate(data)
      expect(() => parseParticipation(data, 'capture')).toThrow()
    }
  })
})

describe('age-turnout data contract', () => {
  it('keeps an unpublished second round absent, then accepts complete official second-round age counts', () => {
    const data = ageFixture()
    expect(parseAgeData(data).second.bands).toEqual([])
    data.second = { ...structuredClone(data.first), sourceGeneratedAt: '2026-10-26T00:00:00Z' }
    expect(parseAgeData(data).second.status).toBe('available')
  })

  it('rejects partial coverage masquerading as complete, duplicate ages and inconsistent counts/statuses', () => {
    const cases = [
      (data: AgeData) => { data.first.states.pop() },
      (data: AgeData) => { data.first.bands.push(data.first.bands[0]!) },
      (data: AgeData) => { data.first.bands[0]!.attended += 1 },
      (data: AgeData) => { data.first.bands[0]!.code = 'unrecognized' },
      (data: AgeData) => { data.first.status = 'not-published' },
      (data: AgeData) => { data.first.sourceGeneratedAt = '2022-10-26T00:00:00Z' },
      (data: AgeData) => { data.lastSuccessAt = null },
      (data: AgeData) => { data.refresh = 'error'; data.error = null },
    ]
    for (const mutate of cases) {
      const data = ageFixture()
      mutate(data)
      expect(() => parseAgeData(data)).toThrow()
    }
  })
})
