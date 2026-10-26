import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatasetManifest, DatasetResource, DatasetSummary, RoundComparison } from '../domain/comparison'
import { loadComparison, loadDataset, parseDatasetManifest, parseDatasetSummary, parseMunicipalityShard } from './comparison'

const states = 'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' ')
const now = '2026-10-26T07:00:00Z'
const signal = () => new AbortController().signal
const finalists = [
  { id: '100', number: '13', name: 'A', party: 'PT' },
  { id: '200', number: '22', name: 'B', party: 'PL' },
]

function comparison(id: string, kind: RoundComparison['geography']['kind']): RoundComparison {
  const round = {
    validVotes: 3, totalVotes: 5, blankVotes: 1, nullVotes: 1,
    votes: { '100': 1, '200': 2 }, otherVotes: 0,
    sections: { total: 1, counted: 1 }, countingComplete: true,
    sourceTimes: { oldest: now, latest: now }, coverage: { received: 1, expected: 1 },
  }
  return {
    geography: { id, kind, label: id },
    first: { ...structuredClone(round), electionId: '6257' },
    second: { ...structuredClone(round), electionId: '6258' },
  }
}

function makeSummary(version = 'v1'): DatasetSummary {
  const second = { id: '6258', cycle: 'ele2026', name: 'Presidencial', date: '2026-10-25', year: 2026, round: '2' as const }
  return {
    schemaVersion: 1, version, generatedAt: now,
    metadata: {
      election: second,
      states: states.map((code, index) => ({
        code, name: code, municipalities: [
          { code: String(index * 2 + 1).padStart(5, '0'), name: `${code} 1` },
          { code: String(index * 2 + 2).padStart(5, '0'), name: `${code} 2` },
        ],
      })),
      countries: [{ code: 'PT', name: 'Portugal', municipalities: [{ code: '99999', name: 'Lisboa' }] }],
      overseasMunicipalities: [{ code: '99999', name: 'Lisboa' }],
    },
    elections: { first: { ...second, id: '6257', round: '1', date: '2026-10-04' }, second },
    finalists,
    comparisons: [
      comparison('overall', 'overall'), comparison('domestic', 'domestic'), comparison('overseas', 'overseas'),
      ...states.map((state) => comparison(`state:${state}`, 'state')), comparison('country:PT', 'country'),
    ],
  }
}

async function descriptor(path: string, text: string): Promise<DatasetResource> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return {
    path, bytes: bytes.length,
    sha256: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
  }
}

async function fixtures(version = 'v1') {
  const summary = makeSummary(version)
  const files = new Map<string, string>()
  const municipalities: DatasetManifest['municipalities'] = {}
  for (const state of summary.metadata.states) {
    const shard = {
      schemaVersion: 1, version, state: state.code,
      comparisons: state.municipalities.map(({ code }) => comparison(`municipality:${state.code}:${code}`, 'municipality')),
    }
    const path = `${version}/${state.code}.json`
    const text = JSON.stringify(shard)
    files.set(path, text)
    municipalities[state.code] = await descriptor(path, text)
  }
  const summaryText = JSON.stringify(summary)
  const manifest: DatasetManifest = {
    schemaVersion: 1, version, generatedAt: now,
    summary: await descriptor(`${version}/summary.json`, summaryText), municipalities,
    provenance: await descriptor(`${version}/provenance.json`, '{}'),
  }
  files.set(manifest.summary.path, summaryText)
  files.set('manifest.json', JSON.stringify(manifest))
  return { files, manifest, summary }
}

const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.stubEnv('BASE_URL', './')
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('TextEncoder', globalThis.TextEncoder)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fetchMock.mockReset()
})

function serve(files: Map<string, string>) {
  fetchMock.mockImplementation(async (input) => {
    const path = String(input).split('data/2026/')[1]!
    const text = files.get(path)
    return text === undefined ? new Response('', { status: 404 }) : new Response(text)
  })
}

describe('immutable static comparison loading', () => {
  it.each(['./', '/', '/eleicoes-brasil/'])('honors base %s and loads only manifest/summary for every summary selection', async (base) => {
    vi.stubEnv('BASE_URL', base)
    const { files } = await fixtures()
    serve(files)
    const dataset = await loadDataset(signal())
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${base}data/2026/manifest.json`, `${base}data/2026/v1/summary.json`,
    ])
    for (const selection of [
      { scope: 'overall' }, { scope: 'domestic' }, { scope: 'overseas' },
      { scope: 'domestic', state: 'sp' }, { scope: 'overseas', country: 'PT' },
    ] as const) await loadComparison(dataset, selection, signal())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lazily fetches one UF shard, deduplicates concurrent callers and caches sibling cities', async () => {
    const { files } = await fixtures()
    serve(files)
    const dataset = await loadDataset(signal())
    const [one, two] = await Promise.all([
      loadComparison(dataset, { scope: 'domestic', state: 'ac', municipality: '00001' }, signal()),
      loadComparison(dataset, { scope: 'domestic', state: 'ac', municipality: '00002' }, signal()),
    ])
    expect(one.geography.id).toBe('municipality:ac:00001')
    expect(two.geography.id).toBe('municipality:ac:00002')
    await loadComparison(dataset, { scope: 'domestic', state: 'ac', municipality: '00001' }, signal())
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('rejects tampered bytes, hash, invalid JSON and HTTP errors without caching failures', async () => {
    const { files } = await fixtures()
    serve(files)
    const dataset = await loadDataset(signal())
    const original = files.get('v1/ac.json')!
    const selection = { scope: 'domestic', state: 'ac', municipality: '00001' } as const
    files.set('v1/ac.json', original + ' ')
    await expect(loadComparison(dataset, selection, signal())).rejects.toThrow(/Tamanho/)
    files.set('v1/ac.json', original.replace('"validVotes":3', '"validVotes":4'))
    await expect(loadComparison(dataset, selection, signal())).rejects.toThrow(/SHA-256/)
    files.delete('v1/ac.json')
    await expect(loadComparison(dataset, selection, signal())).rejects.toThrow(/HTTP 404/)
    files.set('v1/ac.json', 'bad')
    dataset.manifest.municipalities.ac = await descriptor('v1/ac.json', 'bad')
    await expect(loadComparison(dataset, selection, signal())).rejects.toThrow(/JSON/)
    files.set('v1/ac.json', original)
    dataset.manifest.municipalities.ac = await descriptor('v1/ac.json', original)
    await expect(loadComparison(dataset, selection, signal())).resolves.toMatchObject({ geography: { id: 'municipality:ac:00001' } })
  })

  it('validates schema, election identities, final coverage, inventories and candidate grouping', async () => {
    const { manifest, summary } = await fixtures()
    expect(parseDatasetManifest(manifest)).toEqual(manifest)
    expect(parseDatasetSummary(summary, manifest)).toEqual(summary)
    for (const mutate of [
      (value: DatasetSummary) => { value.version = 'wrong' },
      (value: DatasetSummary) => { value.metadata.election.round = '1' },
      (value: DatasetSummary) => { value.elections.first.id = 'wrong' },
      (value: DatasetSummary) => { value.elections.first.year = 2022 },
      (value: DatasetSummary) => { value.comparisons[0]!.first.countingComplete = false },
      (value: DatasetSummary) => { value.comparisons[0]!.second.electionId = '6257' },
      (value: DatasetSummary) => { value.comparisons[0]!.first.votes['999'] = 0 },
      (value: DatasetSummary) => { value.comparisons[0]!.first.validVotes = 4 },
      (value: DatasetSummary) => { value.comparisons[0]!.first.coverage.expected = 2 },
      (value: DatasetSummary) => { value.metadata.countries[0]!.municipalities.pop() },
      (value: DatasetSummary) => { value.comparisons.pop() },
      (value: DatasetSummary) => { value.comparisons.push(value.comparisons[0]!) },
      (value: DatasetSummary) => { value.comparisons[0]!.geography.kind = 'state' },
    ]) {
      const value = structuredClone(summary)
      mutate(value)
      expect(() => parseDatasetSummary(value, manifest)).toThrow()
    }
    for (const mutate of [
      (value: DatasetManifest) => { delete value.municipalities.ac },
      (value: DatasetManifest) => { value.summary.path = '../summary.json' },
      (value: DatasetManifest) => { value.summary.path = 'v2/summary.json' },
      (value: DatasetManifest) => { value.provenance.path = value.summary.path },
    ]) {
      const value = structuredClone(manifest)
      mutate(value)
      expect(() => parseDatasetManifest(value)).toThrow()
    }
  })

  it('rejects wrong shard version/state/geography and incomplete city sets even with correct hash', async () => {
    const { files, summary, manifest } = await fixtures()
    const dataset = { summary, manifest }
    const original = JSON.parse(files.get('v1/ac.json')!) as { version: string; state: string; comparisons: RoundComparison[] }
    for (const mutate of [
      (value: typeof original) => { value.version = 'v2' },
      (value: typeof original) => { value.state = 'sp' },
      (value: typeof original) => { value.comparisons[0]!.geography.id = 'municipality:sp:00001' },
      (value: typeof original) => { value.comparisons.pop() },
    ]) {
      const value = structuredClone(original)
      mutate(value)
      expect(() => parseMunicipalityShard(value, dataset, 'ac')).toThrow()
    }
    serve(files)
    const value = structuredClone(original)
    value.version = 'wrong'
    const text = JSON.stringify(value)
    files.set('v1/ac.json', text)
    manifest.municipalities.ac = await descriptor('v1/ac.json', text)
    await expect(loadComparison(dataset, { scope: 'domestic', state: 'ac', municipality: '00001' }, signal()))
      .rejects.toThrow(/Versão/)
    await expect(loadComparison(dataset, { scope: 'domestic', state: 'ac', municipality: '99999' }, signal()))
      .rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('isolates caches by loaded dataset/version', async () => {
    const first = await fixtures('v1')
    const second = await fixtures('v2')
    const files = new Map([...first.files, ...second.files])
    serve(files)
    const selection = { scope: 'domestic', state: 'ac', municipality: '00001' } as const
    await loadComparison({ manifest: first.manifest, summary: first.summary }, selection, signal())
    await loadComparison({ manifest: second.manifest, summary: second.summary }, selection, signal())
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      './data/2026/v1/ac.json', './data/2026/v2/ac.json',
    ])
  })

  it('does not let one cancelled subscriber poison concurrent readers', async () => {
    const { files, manifest, summary } = await fixtures()
    const dataset = { manifest, summary }
    let resolveFetch!: (response: Response) => void
    let sharedSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, options) => {
      sharedSignal = options?.signal as AbortSignal
      return new Promise((resolve) => { resolveFetch = resolve })
    })
    const controller = new AbortController()
    const selection = { scope: 'domestic', state: 'ac', municipality: '00001' } as const
    const cancelled = loadComparison(dataset, selection, controller.signal)
    const cancelledAssertion = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const survivor = loadComparison(dataset, selection, signal())
    controller.abort()
    await cancelledAssertion
    expect(sharedSignal?.aborted).toBe(false)
    resolveFetch(new Response(files.get('v1/ac.json')))
    await expect(survivor).resolves.toMatchObject({ geography: { id: 'municipality:ac:00001' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts abandoned shared requests and permits immediate retry without old promise poisoning', async () => {
    const { files, manifest, summary } = await fixtures()
    const dataset = { manifest, summary }
    let finishAbandoned!: (response: Response) => void
    let abandonedSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url, options) => {
      abandonedSignal = options?.signal as AbortSignal
      return new Promise((resolve) => { finishAbandoned = resolve })
    })
    const controller = new AbortController()
    const selection = { scope: 'domestic', state: 'ac', municipality: '00001' } as const
    const abandoned = loadComparison(dataset, selection, controller.signal)
    const rejected = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(abandonedSignal?.aborted).toBe(true)
    serve(files)
    const retry = loadComparison(dataset, selection, signal())
    finishAbandoned(new Response(files.get('v1/ac.json')))
    await expect(retry).resolves.toMatchObject({ geography: { id: 'municipality:ac:00001' } })
    await loadComparison(dataset, selection, signal())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects already-aborted requests before fetching, including cached summary results', async () => {
    const { manifest, summary } = await fixtures()
    const controller = new AbortController()
    controller.abort()
    await expect(loadDataset(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(loadComparison({ manifest, summary }, { scope: 'overall' }, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
