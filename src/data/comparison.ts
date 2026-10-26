import { z } from 'zod'
import {
  validateRoundComparison,
  type DatasetManifest, type DatasetResource, type DatasetSummary, type MunicipalityShard,
  type RoundComparison,
} from '../domain/comparison'
import { ResultDataError, type Geography } from '../domain/results'
import { selectionId, SelectionError, type Selection } from '../domain/selection'

const states = 'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' ')
const text = z.string().min(1)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime({ offset: true })
const municipality = z.strictObject({ code: z.string().regex(/^\d{5}$/), name: text })
const election = z.strictObject({
  id: z.string().regex(/^\d+$/), cycle: z.literal('ele2026'), name: text,
  date: z.iso.date(), year: z.literal(2026), round: z.enum(['1', '2']),
})
const metadata = z.strictObject({
  election,
  states: z.array(z.strictObject({
    code: z.string().regex(/^[a-z]{2}$/), name: text, municipalities: z.array(municipality).min(1),
  })).length(27),
  countries: z.array(z.strictObject({
    code: z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/), name: text,
    municipalities: z.array(municipality).min(1),
  })).min(1),
  overseasMunicipalities: z.array(municipality).min(1),
})
const geography = z.strictObject({
  id: text, kind: z.enum(['overall', 'domestic', 'overseas', 'state', 'municipality', 'country']), label: text,
})
const round = z.strictObject({
  electionId: text, validVotes: count, totalVotes: count, blankVotes: count, nullVotes: count,
  votes: z.record(text, count), otherVotes: count,
  sections: z.strictObject({ total: count, counted: count }),
  countingComplete: z.boolean(),
  sourceTimes: z.strictObject({ oldest: timestamp, latest: timestamp }),
  coverage: z.strictObject({ received: count, expected: count }),
})
const comparison = z.strictObject({ geography, first: round, second: round })
const resource = z.strictObject({
  path: z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.json$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: count.positive(),
})
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1), version: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  generatedAt: timestamp, summary: resource,
  municipalities: z.record(z.string(), resource), provenance: resource,
})
const summarySchema = z.strictObject({
  schemaVersion: z.literal(1), version: text, generatedAt: timestamp, metadata,
  elections: z.strictObject({ first: election, second: election }),
  finalists: z.array(z.strictObject({
    id: text, number: text, name: text, party: text,
  })).length(2),
  comparisons: z.array(comparison),
})
const shardSchema = z.strictObject({
  schemaVersion: z.literal(1), version: text, state: z.string().regex(/^[a-z]{2}$/),
  comparisons: z.array(comparison),
})

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ResultDataError(message)
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new ResultDataError('Formato do conjunto estático inválido.')
  return parsed.data
}

function exactIds(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length &&
    new Set(expected).size === expected.length &&
    expected.every((id) => actual.includes(id))
}

export function parseDatasetManifest(value: unknown): DatasetManifest {
  const manifest = parse(manifestSchema, value)
  check(exactIds(Object.keys(manifest.municipalities), states), 'Inventário de arquivos das 27 UFs inválido.')
  const resources = [manifest.summary, manifest.provenance, ...Object.values(manifest.municipalities)]
  check(resources.every(({ path }) => path.startsWith(`${manifest.version}/`)), 'Arquivo de outra versão.')
  check(new Set(resources.map(({ path }) => path)).size === resources.length, 'Arquivos duplicados no manifesto.')
  return manifest
}

export function parseDatasetSummary(value: unknown, manifest: DatasetManifest): DatasetSummary {
  const summary = parse(summarySchema, value)
  check(summary.version === manifest.version && summary.generatedAt === manifest.generatedAt,
    'Versão do resumo difere do manifesto.')
  check(summary.elections.first.id === '6257' && summary.elections.second.id === '6258' &&
    summary.elections.first.round === '1' && summary.elections.second.round === '2' &&
    summary.elections.first.date === '2026-10-04' && summary.elections.second.date === '2026-10-25',
  'Identidade das eleições de 2026 inválida.')
  check(Object.entries(summary.elections.second).every(([key, value]) =>
    summary.metadata.election[key as keyof DatasetSummary['metadata']['election']] === value),
    'Metadados de navegação não correspondem ao segundo turno.')
  check(exactIds(summary.metadata.states.map(({ code }) => code), states), 'Inventário das 27 UFs inválido.')
  const domesticCodes = summary.metadata.states.flatMap(({ municipalities }) => municipalities.map(({ code }) => code))
  check(new Set(domesticCodes).size === domesticCodes.length, 'Municípios domésticos duplicados.')
  const overseasCodes = summary.metadata.overseasMunicipalities.map(({ code }) => code)
  const mappedCodes = summary.metadata.countries.flatMap(({ municipalities }) => municipalities.map(({ code }) => code))
  check(exactIds(mappedCodes, overseasCodes) && new Set(overseasCodes).size === overseasCodes.length,
    'Cobertura dos países inconsistente.')
  const expected = summaryGeographies(summary)
  validateComparisons(summary.comparisons, expected, summary)
  return summary
}

function summaryGeographies(summary: DatasetSummary): Geography[] {
  return [
    { id: 'overall', kind: 'overall', label: 'Total geral' },
    { id: 'domestic', kind: 'domestic', label: 'Brasil' },
    { id: 'overseas', kind: 'overseas', label: 'Exterior' },
    ...summary.metadata.states.map(({ code, name }) => ({ id: `state:${code}`, kind: 'state' as const, label: name })),
    ...summary.metadata.countries.map(({ code, name }) => ({ id: `country:${code}`, kind: 'country' as const, label: name })),
  ]
}

function validateComparisons(
  comparisons: RoundComparison[], expected: Geography[], summary: DatasetSummary,
): void {
  check(exactIds(comparisons.map(({ geography }) => geography.id), expected.map(({ id }) => id)),
    'Cobertura geográfica incompleta ou duplicada.')
  const byId = new Map(expected.map((item) => [item.id, item]))
  for (const item of comparisons) {
    const target = byId.get(item.geography.id)!
    check(item.geography.kind === target.kind, 'Tipo da localidade inconsistente.')
    // Labels are source presentation text; identifiers, not translated labels, establish identity.
    validateRoundComparison(item, summary.finalists, summary.elections)
  }
}

export function parseMunicipalityShard(
  value: unknown, dataset: LoadedDataset, state: string,
): MunicipalityShard {
  const shard = parse(shardSchema, value)
  check(shard.version === dataset.manifest.version && shard.state === state,
    'Versão ou UF do arquivo de municípios incorreta.')
  const stateMetadata = dataset.summary.metadata.states.find(({ code }) => code === state)
  check(stateMetadata !== undefined, 'UF ausente dos metadados.')
  validateComparisons(shard.comparisons, stateMetadata.municipalities.map(({ code, name }) => ({
    id: `municipality:${state}:${code}`, kind: 'municipality', label: name,
  })), dataset.summary)
  return shard
}

export interface LoadedDataset {
  manifest: DatasetManifest
  summary: DatasetSummary
}

function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/2026/${path}`
}

async function fetchJson(path: string, signal: AbortSignal, expected?: DatasetResource): Promise<unknown> {
  signal.throwIfAborted()
  const response = await fetch(dataUrl(path), {
    signal, cache: expected ? 'force-cache' : 'no-store',
  })
  check(response.ok, `Não foi possível carregar os dados estáticos (HTTP ${response.status}).`)
  const bytes = await response.arrayBuffer()
  signal.throwIfAborted()
  if (expected) {
    check(bytes.byteLength === expected.bytes, 'Tamanho do arquivo estático inconsistente.')
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    signal.throwIfAborted()
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    check(hash === expected.sha256, 'SHA-256 do arquivo estático inconsistente.')
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new ResultDataError('JSON estático inválido.')
  }
}

export async function loadDataset(signal: AbortSignal): Promise<LoadedDataset> {
  const manifest = parseDatasetManifest(await fetchJson('manifest.json', signal))
  const summary = parseDatasetSummary(await fetchJson(manifest.summary.path, signal, manifest.summary), manifest)
  signal.throwIfAborted()
  return { manifest, summary }
}

interface PendingShard {
  promise: Promise<MunicipalityShard>
  controller: AbortController
  subscribers: number
}

interface ShardCache {
  ready: Map<string, MunicipalityShard>
  pending: Map<string, PendingShard>
}

// Cache lifetime is the loaded manifest object, preventing cross-generation mixing.
const caches = new WeakMap<LoadedDataset, ShardCache>()

function subscribe(entry: PendingShard, signal: AbortSignal, cancel: () => void): Promise<MunicipalityShard> {
  signal.throwIfAborted()
  entry.subscribers++
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      entry.subscribers--
      if (entry.subscribers === 0) cancel()
      callback()
    }
    const abort = () => finish(() => reject(signal.reason))
    signal.addEventListener('abort', abort, { once: true })
    entry.promise.then(
      (shard) => finish(() => resolve(shard)),
      (error: unknown) => finish(() => reject(error)),
    )
    if (signal.aborted) abort()
  })
}

async function loadShard(dataset: LoadedDataset, state: string, signal: AbortSignal): Promise<MunicipalityShard> {
  signal.throwIfAborted()
  let cache = caches.get(dataset)
  if (!cache) {
    cache = { ready: new Map(), pending: new Map() }
    caches.set(dataset, cache)
  }
  const currentCache = cache
  const ready = cache.ready.get(state)
  if (ready) return ready
  let entry = cache.pending.get(state)
  if (!entry) {
    const descriptor = dataset.manifest.municipalities[state]
    check(descriptor !== undefined && states.includes(state), 'Arquivo da UF não disponível.')
    const controller = new AbortController()
    const pending: PendingShard = {
      controller, subscribers: 0,
      promise: fetchJson(descriptor.path, controller.signal, descriptor)
        .then((value) => {
          controller.signal.throwIfAborted()
          const shard = parseMunicipalityShard(value, dataset, state)
          currentCache.ready.set(state, shard)
          return shard
        })
        .finally(() => {
          if (currentCache.pending.get(state) === pending) currentCache.pending.delete(state)
        }),
    }
    cache.pending.set(state, pending)
    entry = pending
  }
  const pending = entry
  return subscribe(pending, signal, () => {
    if (currentCache.pending.get(state) === pending) {
      currentCache.pending.delete(state)
      pending.controller.abort()
    }
  })
}

export async function loadComparison(
  dataset: LoadedDataset, selection: Selection, signal: AbortSignal,
): Promise<RoundComparison> {
  signal.throwIfAborted()
  // Runtime callers still must not create malformed combinations that selectionId ignores.
  if (selection.scope === 'domestic' && selection.municipality && !selection.state) throw new SelectionError()
  const id = selectionId(selection)
  if (selection.scope === 'domestic' && selection.municipality) {
    const state = dataset.summary.metadata.states.find(({ code }) => code === selection.state)
    if (!state?.municipalities.some(({ code }) => code === selection.municipality)) throw new SelectionError()
    const shard = await loadShard(dataset, state.code, signal)
    signal.throwIfAborted()
    const result = shard.comparisons.find(({ geography }) => geography.id === id)
    check(result !== undefined, 'Município ausente do arquivo estático.')
    return result
  }
  const result = dataset.summary.comparisons.find(({ geography }) => geography.id === id)
  if (!result) throw new SelectionError()
  return result
}
