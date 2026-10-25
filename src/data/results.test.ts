import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectionMetadata } from '../domain/geography'
import { percentage } from '../domain/results'
import { SelectionError, type Selection } from '../domain/selection'
import { loadSelectionResult } from './results'
import { loadMetadata, OfficialValidationError } from './tse/client'
import { OfficialRequestError, retryDelay, shouldRetry } from './tse/http'

const fixture = (name: string) =>
  readFileSync(resolve('tests', 'fixtures', `${name}.jws`), 'utf8')
const stateCodes = 'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' ')
const path = (state: string, municipality = '') =>
  `/oficial/ele2026/6258/dados/${state}/${state}${municipality}-c0001-e006258-u.jws`
const signal = () => new AbortController().signal

function fixtureFor(url: URL): string {
  if (url.pathname.endsWith('/ele-c.jws')) return 'elections'
  if (url.pathname.endsWith('/mun-e006258-cm.jws')) return 'municipalities'
  const match = /\/dados\/([a-z]{2})\/[a-z]{2}(\d{5})?-c0001-e006258-u\.jws$/.exec(url.pathname)
  if (!match) throw new Error(`Unexpected request: ${url}`)
  const [, state, municipality] = match
  if (municipality) return `${state === 'zz' ? 'locality' : 'municipality'}-${state}${municipality}`
  return state === 'br' ? 'overall' : state === 'zz' ? 'overseas' : `state-${state}`
}

const fetchMock = vi.fn<typeof fetch>()
let metadata: ElectionMetadata

beforeEach(async () => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (input) => new Response(fixture(fixtureFor(new URL(String(input))))))
  metadata = await loadMetadata(signal())
  fetchMock.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  fetchMock.mockReset()
})

function requestedPaths() {
  return fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname).sort()
}

describe('selection source integration with real signed fixtures', () => {
  it.each([
    [{ scope: 'overall' }, 'br', '', 'overall'],
    [{ scope: 'overseas' }, 'zz', '', 'overseas'],
    [{ scope: 'domestic', state: 'sp' }, 'sp', '', 'state:sp'],
    [{ scope: 'domestic', state: 'sp', municipality: '71072' }, 'sp', '71072', 'municipality:sp:71072'],
  ] satisfies Array<[Selection, string, string, string]>)(
    'passes through %j without fetching other views',
    async (selection, state, municipality, id) => {
      const result = await loadSelectionResult(metadata, selection, signal())
      expect(requestedPaths()).toEqual([path(state, municipality)])
      expect(result.geography.id).toBe(id)
      expect(result.coverage).toEqual({ received: 1, expected: 1 })
      if (municipality) {
        expect(result.validVotes).toBe(0)
        expect(percentage(result.candidates[0]!.votes, result.validVotes)).toBeNull()
      }
      if (state === 'zz') {
        expect(result.sections).toEqual({ total: 1351, counted: 817 })
        expect(result.totalVotes).toBe(243602)
      }
    },
  )

  it('sums exactly all 27 UFs including DF, never ZZ or municipalities', async () => {
    const now = Date.now()
    const result = await loadSelectionResult(metadata, { scope: 'domestic' }, signal())
    expect(requestedPaths()).toEqual(stateCodes.map((state) => path(state)).sort())
    expect(result).toMatchObject({
      electionId: '6258',
      geography: { id: 'domestic', kind: 'domestic', label: 'Brasil' },
      totalVotes: 5779950, validVotes: 5608565, blankVotes: 57550, nullVotes: 113835,
      sections: { total: 497897, counted: 22497 },
      coverage: { received: 27, expected: 27 },
      countingComplete: false,
      sourceTimes: { oldest: '2026-10-25T22:22:15.000Z', latest: '2026-10-25T22:28:17.000Z' },
    })
    expect(result.candidates.map(({ id, votes, elected }) => ({ id, votes, elected })))
      .toEqual([
        { id: '280002551544', votes: 2757414, elected: false },
        { id: '280002542548', votes: 2851151, elected: false },
      ])
    expect(percentage(result.candidates[0]!.votes, result.validVotes))
      .toBeCloseTo(2757414 / 5608565 * 100)
    expect(percentage(result.sections.counted, result.sections.total))
      .toBeCloseTo(22497 / 497897 * 100)
    expect(result.constituents).toHaveLength(27)
    expect(result.constituents?.find((state) => state.geography.id === 'state:sp')?.validVotes)
      .toBeGreaterThanOrEqual(0)
    expect(Date.parse(result.fetchedAt)).toBeGreaterThanOrEqual(now)
    expect(Date.parse(result.fetchedAt)).toBeLessThanOrEqual(Date.now())
  })

  it('sums only the three exact Portugal mapping members, retaining source progress', async () => {
    const result = await loadSelectionResult(metadata, { scope: 'overseas', country: 'portugal' }, signal())
    expect(requestedPaths()).toEqual(['29955', '30341', '30961'].map((code) => path('zz', code)))
    expect(result).toMatchObject({
      geography: { id: 'country:portugal', kind: 'country', label: 'Portugal' },
      totalVotes: 59040, validVotes: 57752, blankVotes: 628, nullVotes: 660,
      sections: { total: 176, counted: 176 },
      coverage: { received: 3, expected: 3 },
      // Counted sections alone are not the official final/elected flags.
      countingComplete: false,
      sourceTimes: { oldest: '2026-10-25T20:06:07.000Z', latest: '2026-10-25T20:06:08.000Z' },
    })
    expect(result.candidates.map(({ votes, elected }) => ({ votes, elected })))
      .toEqual([{ votes: 23433, elected: false }, { votes: 34319, elected: false }])
    expect(percentage(result.candidates[0]!.votes, result.validVotes)).toBeCloseTo(23433 / 57752 * 100)
    expect(Number.isFinite(Date.parse(result.fetchedAt))).toBe(true)
  })

  it.each(['missing', 'duplicate', 'unknown', 'zz', 'extra'] as const)(
    'rejects a %s domestic inventory before any requests',
    async (problem) => {
      if (problem === 'missing') metadata.states.pop()
      if (problem === 'duplicate') metadata.states[0] = metadata.states[1]!
      if (problem === 'unknown') metadata.states[0]!.code = 'xx'
      if (problem === 'zz') metadata.states[0]!.code = 'zz'
      if (problem === 'extra') metadata.states.push({ code: 'zz', name: 'Exterior', municipalities: [] })
      await expect(loadSelectionResult(metadata, { scope: 'domestic' }, signal()))
        .rejects.toBeInstanceOf(OfficialValidationError)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it.each([
    { scope: 'domestic', municipality: '71072' },
    { scope: 'domestic', state: '' },
    { scope: 'domestic', state: 'zz' },
    { scope: 'domestic', state: 'br' },
    { scope: 'domestic', state: 'xx' },
    { scope: 'overseas', country: '' },
    { scope: 'overseas', country: 'Portugal' },
    { scope: 'overseas', country: 'pt' },
    { scope: 'overseas', country: 'unknown' },
  ] satisfies Selection[])('rejects invalid selection %j without silent fallback', async (selection) => {
    await expect(loadSelectionResult(metadata, selection, signal())).rejects.toBeInstanceOf(SelectionError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { scope: 'domestic', state: 'sp', municipality: '01120' },
    { scope: 'domestic', state: 'sp', municipality: '' },
    { scope: 'domestic', state: 'sp', municipality: '29955' },
  ] satisfies Selection[])('preserves strict client membership for %j', async (selection) => {
    await expect(loadSelectionResult(metadata, selection, signal()))
      .rejects.toBeInstanceOf(OfficialValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['empty', 'duplicate', 'unknown', 'domestic', 'duplicate-country'] as const)(
    'rejects %s country mappings without requests',
    async (problem) => {
      const country = metadata.countries.find(({ code }) => code === 'portugal')!
      if (problem === 'empty') country.municipalities = []
      if (problem === 'duplicate') country.municipalities.push(country.municipalities[0]!)
      if (problem === 'unknown') country.municipalities[0] = { code: '00000', name: 'Unknown' }
      if (problem === 'domestic') country.municipalities[0] = { code: '71072', name: 'São Paulo' }
      if (problem === 'duplicate-country') metadata.countries.push(country)
      await expect(loadSelectionResult(metadata, { scope: 'overseas', country: 'portugal' }, signal()))
        .rejects.toBeInstanceOf(OfficialValidationError)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('does not accept a domestic state missing from the election metadata', async () => {
    metadata.states = metadata.states.filter(({ code }) => code !== 'sp')
    await expect(loadSelectionResult(metadata, { scope: 'domestic', state: 'sp' }, signal()))
      .rejects.toBeInstanceOf(OfficialValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('complete-or-error and cancellation', () => {
  it.each([
    { scope: 'domestic' },
    { scope: 'overseas', country: 'portugal' },
  ] satisfies Selection[])('rejects missing children and cancels siblings for %j', async (selection) => {
    const siblingSignals: AbortSignal[] = []
    fetchMock.mockImplementation(async (_url, options) => {
      const currentSignal = options!.signal!
      siblingSignals.push(currentSignal)
      if (siblingSignals.length === 1) return new Response('', { status: 404 })
      return new Promise<Response>((_resolve, reject) => {
        currentSignal.addEventListener('abort', () => reject(currentSignal.reason), { once: true })
      })
    })
    await expect(loadSelectionResult(metadata, selection, signal()))
      .rejects.toMatchObject({ name: 'OfficialRequestError', status: 404 })
    expect(siblingSignals.length).toBeGreaterThan(1)
    expect(siblingSignals.every((item) => item.aborted)).toBe(true)
  })

  it('preserves HTTP retry guidance and error identity through sibling cancellation', async () => {
    const siblings: AbortSignal[] = []
    fetchMock.mockImplementation(async (_url, options) => {
      const currentSignal = options!.signal!
      siblings.push(currentSignal)
      if (siblings.length === 1) {
        return new Response('', { status: 429, headers: { 'Retry-After': '7' } })
      }
      return new Promise<Response>((_resolve, reject) => {
        currentSignal.addEventListener('abort', () => reject(currentSignal.reason), { once: true })
      })
    })
    const error: unknown = await loadSelectionResult(metadata, { scope: 'domestic' }, signal()).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(OfficialRequestError)
    expect(error).toMatchObject({ status: 429, retryAfterMs: 7000 })
    expect(siblings.every((item) => item.reason === error)).toBe(true)
    expect(shouldRetry(0, error as Error)).toBe(true)
    expect(retryDelay(0, error as Error)).toBe(7000)
  })

  it('preserves a transport failure cause, not an aggregate wrapper', async () => {
    const cause = new TypeError('offline')
    fetchMock.mockRejectedValue(cause)
    const error: unknown = await loadSelectionResult(metadata, { scope: 'domestic' }, signal()).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(OfficialRequestError)
    expect(error).toMatchObject({ cause, status: null })
    expect((error as Error).cause).toBe(cause)
  })

  it('rejects a signed child for the wrong geography rather than returning partial success', async () => {
    fetchMock.mockImplementation(async () => new Response(fixture('state-sp')))
    await expect(loadSelectionResult(metadata, { scope: 'overseas', country: 'portugal' }, signal()))
      .rejects.toBeInstanceOf(OfficialValidationError)
  })

  it('aborts both active and queued children on incoming cancellation', async () => {
    const controller = new AbortController()
    const reason = new Error('view changed')
    const active: AbortSignal[] = []
    fetchMock.mockImplementation(async (_url, options) => {
      const currentSignal = options!.signal!
      active.push(currentSignal)
      if (active.length === 4) queueMicrotask(() => controller.abort(reason))
      return new Promise<Response>((_resolve, reject) => {
        currentSignal.addEventListener('abort', () => reject(currentSignal.reason), { once: true })
      })
    })
    const pending = loadSelectionResult(metadata, { scope: 'domestic' }, controller.signal)
    await expect(pending).rejects.toBe(reason)
    expect(active).toHaveLength(4)
    expect(active.every((item) => item.aborted)).toBe(true)
  })

  it('does not fetch for a signal that is already aborted', async () => {
    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(loadSelectionResult(metadata, { scope: 'domestic' }, controller.signal))
      .rejects.toBe(reason)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
