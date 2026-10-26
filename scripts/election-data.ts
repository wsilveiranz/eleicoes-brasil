import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { discoverElection, normalizeMetadata, normalizeResult } from '../src/data/tse/client'
import { fetchOfficialText, retryDelay, shouldRetry, TSE_ORIGIN } from '../src/data/tse/http'
import { verifyOfficialJws } from '../src/data/tse/validation'
import { TSE_PUBLIC_JWK } from '../src/data/tse/trust'
import { aggregateResults } from '../src/domain/results'
import type { ResultSnapshot, Geography } from '../src/domain/results'
import type { ElectionMetadata } from '../src/domain/geography'
import countryMapping from '../src/data/geography/countries.json'
import type { RoundComparison } from '../src/domain/comparison'
import { resultSchema } from '../src/data/tse/schemas'
import { z } from 'zod'

export function captureDirectory(name?: string): string {
  if (name === undefined) return resolve('.tse-import-cache', '2026')
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) {
    throw new Error('Nome de captura inválido: use 1–64 letras, números, "_" ou "-", sem nomes reservados.')
  }
  return resolve('.tse-import-cache', '2026', 'captures', name)
}
let cacheRoot = captureDirectory()
const outputRoot = resolve('public', 'data', '2026')
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const json = (value: unknown) => JSON.stringify(value)
const controller = new AbortController()
process.once('SIGINT', () => controller.abort(new Error('Importação interrompida.')))
process.once('SIGTERM', () => controller.abort(new Error('Importação interrompida.')))

interface Capture {
  path: string
  url: string
  sha256: string
  payloadSha256: string
  bytes: number
  collectedAt: string
}

async function atomicWrite(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.pending`, text)
  await rename(`${path}.pending`, path)
}

const captures = new Map<string, Capture>()
const destinationEvidence: Record<string, { valid: number; omitted: number; statuses: Record<string, number> }> = {}
async function capture(path: string): Promise<unknown> {
  controller.signal.throwIfAborted()
  const file = join(cacheRoot, ...path.split('/').filter(Boolean))
  let token: string | undefined
  let collectedAt = new Date().toISOString()
  try {
    token = await readFile(file, 'utf8')
    const record: unknown = JSON.parse(await readFile(`${file}.capture.json`, 'utf8'))
    if (typeof record !== 'object' || record === null || !('sha256' in record) ||
      record.sha256 !== sha256(token) || !('collectedAt' in record) ||
      typeof record.collectedAt !== 'string' || !Number.isFinite(Date.parse(record.collectedAt))) {
      throw new Error(`Cache corrompido: ${path}`)
    }
    collectedAt = record.collectedAt
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    token = undefined
  }
  if (token === undefined) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        token = await fetchOfficialText(path, controller.signal)
        break
      } catch (error) {
        if (!(error instanceof Error) || !shouldRetry(attempt, error)) {
          await atomicWrite(`${file}.failure.json`, json({ path, failedAt: new Date().toISOString(), error: String(error) }))
          throw error
        }
        await sleep(retryDelay(attempt, error), undefined, { signal: controller.signal })
      }
    }
    await verifyOfficialJws(token)
    collectedAt = new Date().toISOString()
    await atomicWrite(file, token)
    await atomicWrite(`${file}.capture.json`, json({ sha256: sha256(token), collectedAt }))
  }
  const payload = await verifyOfficialJws(token)
  const payloadBytes = Buffer.from(token.trim().split('.')[1]!, 'base64url')
  captures.set(path, {
    path, url: `${TSE_ORIGIN}${path}`, sha256: sha256(token),
    payloadSha256: sha256(payloadBytes), bytes: Buffer.byteLength(token), collectedAt,
  })
  return payload
}

function resultPath(metadata: ElectionMetadata, state: string, municipality?: string) {
  const { cycle, id } = metadata.election
  return `/oficial/${cycle}/${id}/dados/${state}/${state}${municipality ?? ''}-c0001-e${id.padStart(6, '0')}-u.jws`
}

export async function pool<T>(items: T[], work: (item: T) => Promise<void>) {
  let cursor = 0
  let failure: unknown
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < items.length && failure === undefined) {
      const item = items[cursor++]!
      try { await work(item) } catch (error) { failure = error }
    }
  }))
  if (failure !== undefined) throw failure
}

function reconcile(parent: ResultSnapshot, children: ResultSnapshot[], label: string) {
  const sum = aggregateResults(parent.geography, children.map((item) => item.geography.id), children)
  const keys = ['totalVotes', 'validVotes', 'blankVotes', 'nullVotes'] as const
  for (const key of keys) {
    if (parent[key] !== sum[key]) throw new Error(`${label}: ${key}: ${parent[key]} != ${sum[key]}`)
  }
  if (parent.sections.total !== sum.sections.total || parent.sections.counted !== sum.sections.counted) {
    throw new Error(`${label}: seções não reconciliadas`)
  }
  for (const candidate of parent.candidates) {
    if (candidate.votes !== sum.candidates.find((item) => item.id === candidate.id)?.votes) {
      throw new Error(`${label}: candidato ${candidate.id} não reconciliado`)
    }
  }
}

async function collect() {
  const discovery = await capture('/oficial/comum/config/ele-c.jws')
  const metadata: ElectionMetadata[] = []
  for (const round of ['1', '2'] as const) {
    const election = discoverElection(discovery, round)
    if (election.id !== (round === '1' ? '6257' : '6258')) throw new Error('Eleição não revisada.')
    metadata.push(normalizeMetadata(election, await capture(
      `/oficial/${election.cycle}/${election.id}/config/mun-e${election.id.padStart(6, '0')}-cm.jws`,
    )))
  }
  const inventory = (data: ElectionMetadata) => json({
    states: data.states, overseas: data.overseasMunicipalities, countries: data.countries,
  })
  if (inventory(metadata[0]!) !== inventory(metadata[1]!)) throw new Error('Inventários dos turnos diferem.')
  const results = new Map<string, ResultSnapshot>()
  const jobs = metadata.flatMap((data) => [
    { data, state: 'br' }, { data, state: 'zz' },
    ...data.states.map((state) => ({ data, state: state.code })),
    ...data.overseasMunicipalities.map((city) => ({ data, state: 'zz', municipality: city.code })),
  ]).concat(metadata.flatMap((data) => data.states.flatMap((state) => state.municipalities.map((city) => ({
    data, state: state.code, municipality: city.code,
  })))))
  let completed = 0
  const statePath = join(cacheRoot, 'import-state.json')
  const expectedPaths = jobs.map((job: { data: ElectionMetadata; state: string; municipality?: string }) =>
    resultPath(job.data, job.state, job.municipality))
  await atomicWrite(statePath, json({
    startedAt: new Date().toISOString(), status: 'collecting', expectedPaths,
  }))
  console.log(`Collecting ${jobs.length} signed results, concurrency 4; cache ${cacheRoot}`)
  try { await pool(jobs, async (job: { data: ElectionMetadata; state: string; municipality?: string }) => {
    const path = resultPath(job.data, job.state, job.municipality)
    try {
    const source = await capture(path)
    const parsed = resultSchema.parse(source)
    const evidence = destinationEvidence[job.data.election.round] ??= { valid: 0, omitted: 0, statuses: {} }
    for (const candidate of parsed.carg[0]!.agr.flatMap((group) => group.par.flatMap((party) => party.cand))) {
      if (candidate.dvt === undefined) evidence.omitted++
      else evidence.valid++
      evidence.statuses[candidate.st] = (evidence.statuses[candidate.st] ?? 0) + 1
    }
    const snapshot = normalizeResult(source, job.data, job, captures.get(path)!.collectedAt)
    if (!snapshot.countingComplete || snapshot.sections.counted !== snapshot.sections.total) {
      throw new Error(`Resultado não final: ${path}`)
    }
    results.set(`${job.data.election.round}:${snapshot.geography.id}`, snapshot)
    completed += 1
    if (completed % 200 === 0) console.log(`${completed}/${jobs.length}`)
    } catch (error) {
      await atomicWrite(join(cacheRoot, 'last-failure.json'), json({ path, failedAt: new Date().toISOString(), error: String(error) }))
      throw new Error(`${path}: ${String(error)}`, { cause: error })
    }
  }) } catch (error) {
    await atomicWrite(statePath, json({
      status: 'failed', failedAt: new Date().toISOString(), error: String(error),
      received: results.size, expected: jobs.length,
      unfinished: expectedPaths.filter((path) => {
        const match = /\/(\d+)\/dados\/([a-z]{2})\/([a-z]{2})(\d{5})?-/.exec(path)
        if (!match) return true
        const round = metadata.find((item) => item.election.id === match[1])!.election.round
        const id = match[4] ? `municipality:${match[2]}:${match[4]}` :
          match[2] === 'br' ? 'overall' : match[2] === 'zz' ? 'overseas' : `state:${match[2]}`
        return !results.has(`${round}:${id}`)
      }),
    }))
    throw error
  }
  await atomicWrite(statePath, json({ status: 'collected', completedAt: new Date().toISOString(), received: results.size, expected: jobs.length }))
  return { metadata, results, jobs: jobs.length }
}

async function generate() {
  const { metadata, results, jobs } = await collect()
  const { createRoundComparison, aggregateComparisonSnapshots } = await import('../src/domain/comparison')
  const get = (round: '1' | '2', id: string) => {
    const value = results.get(`${round}:${id}`)
    if (!value) throw new Error(`Fonte ausente: ${round}:${id}`)
    return value
  }
  const firstNational = get('1', 'overall')
  const secondNational = get('2', 'overall')
  const finalists = secondNational.candidates.map(({ id, number, name, party }) => ({ id, number, name, party }))
    .sort((a, b) => Number(a.number) - Number(b.number))
  if (json(finalists.map(({ id, number, party }) => ({ id, number, party }))) !== json([
    { id: '280002542548', number: '13', party: 'PT' },
    { id: '280002551544', number: '22', party: 'PL' },
  ])) throw new Error('Finalistas nacionais diferem dos identificadores revisados.')
  for (const finalist of finalists) {
    const candidate = firstNational.candidates.find((item) => item.id === finalist.id)
    if (candidate?.number !== finalist.number || candidate.party !== finalist.party) throw new Error('Finalista difere entre turnos.')
  }
  const data = metadata[1]!
  const pair = (id: string) => createRoundComparison(get('1', id), get('2', id), finalists)
  const aggregate = (geography: Geography, ids: string[]) =>
    aggregateComparisonSnapshots(geography, ids, ids.map((id) => get('1', id)), ids.map((id) => get('2', id)), finalists)
  for (const round of ['1', '2'] as const) {
    for (const state of data.states) {
      reconcile(get(round, `state:${state.code}`), state.municipalities.map((city) =>
        get(round, `municipality:${state.code}:${city.code}`)), `${round}:${state.code}`)
    }
    reconcile(get(round, 'overseas'), data.overseasMunicipalities.map((city) =>
      get(round, `municipality:zz:${city.code}`)), `${round}:ZZ`)
    reconcile(get(round, 'overall'), [
      ...data.states.map((state) => get(round, `state:${state.code}`)), get(round, 'overseas'),
    ], `${round}:BR`)
  }
  const comparisons = [
    pair('overall'),
    aggregate({ id: 'domestic', kind: 'domestic', label: 'Brasil' }, data.states.map((state) => `state:${state.code}`)),
    pair('overseas'),
    ...data.states.map((state) => pair(`state:${state.code}`)),
    ...data.countries.map((country) => aggregate(
      { id: `country:${country.code}`, kind: 'country', label: country.name },
      country.municipalities.map((city) => `municipality:zz:${city.code}`),
    )),
  ]
  const orderedCaptures = [...captures.values()].sort((a, b) => a.path.localeCompare(b.path))
  const generatedAt = orderedCaptures.map(({ collectedAt }) => collectedAt).sort().at(-1)!
  const mappingHash = sha256(json(countryMapping))
  const version = `2026-${sha256(json({ sources: orderedCaptures, mappingHash })).slice(0, 16)}`
  const stageRoot = join(cacheRoot, 'generated')
  const writeResource = async (name: string, value: unknown) => {
    const text = json(value)
    const path = `${version}/${name}.json`
    await atomicWrite(join(stageRoot, version, `${name}.json`), text)
    return { path, sha256: sha256(text), bytes: Buffer.byteLength(text) }
  }
  const summary = await writeResource('summary', {
    schemaVersion: 1, version, generatedAt, metadata: data,
    elections: { first: metadata[0]!.election, second: data.election }, finalists, comparisons,
  })
  const municipalities: Record<string, Awaited<ReturnType<typeof writeResource>>> = {}
  for (const state of data.states) {
    municipalities[state.code] = await writeResource(`municipalities-${state.code}`, {
      schemaVersion: 1, version, state: state.code,
      comparisons: state.municipalities.map((city) => pair(`municipality:${state.code}:${city.code}`)),
    })
  }
  const provenance = await writeResource('provenance', {
    schemaVersion: 1, version, generatedAt, origin: TSE_ORIGIN,
    elections: metadata.map((item) => item.election), trustKey: TSE_PUBLIC_JWK,
    countryMapping: { path: 'src/data/geography/countries.json', sha256: mappingHash, hashEncoding: 'UTF-8 JSON.stringify(parsed JSON), independent of checkout line endings', source: countryMapping.sourcePage },
    coverage: { resultFiles: jobs, perRound: { states: 27, domesticMunicipalities: 5571, overseasLocalities: 186, countries: data.countries.length }, received: results.size },
    reconciliation: { municipalitiesToStates: true, overseasLocalitiesToZZ: true, statesAndZZToNational: true, allCandidateVotesToValidVotes: true, allResultsFinal: true },
    semantics: 'Only Válido or omitted dvt; complete candidate sum must equal vv. No annulled candidate votes included. All parent/child integer categories, candidate counts and sections reconcile exactly.',
    voteDestinationEvidence: Object.fromEntries(Object.entries(destinationEvidence).sort().map(([round, value]) => [
      round, { ...value, statuses: Object.fromEntries(Object.entries(value.statuses).sort()) },
    ])),
    zeroValidVoteSources: [...results.values()].filter((item) => item.validVotes === 0)
      .sort((a, b) => `${a.electionId}:${a.geography.id}`.localeCompare(`${b.electionId}:${b.geography.id}`)).map((item) => ({
      electionId: item.electionId, geography: item.geography, totalVotes: item.totalVotes,
      blankVotes: item.blankVotes, nullVotes: item.nullVotes, sections: item.sections,
      countingComplete: item.countingComplete, sourceTimes: item.sourceTimes,
      note: 'Official published final counts; zero is observed, never inferred from a missing source.',
    })),
    captures: orderedCaptures,
  })
  const manifest = { schemaVersion: 1, version, generatedAt, summary, municipalities, provenance }
  await validateManifest(manifest, stageRoot)
  await mkdir(outputRoot, { recursive: true })
  try {
    await rename(join(stageRoot, version), join(outputRoot, version))
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || !['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(String(error.code))) throw error
    await validateManifest(manifest)
    await rm(join(stageRoot, version), { recursive: true, force: true })
  }
  await atomicWrite(join(outputRoot, 'manifest.json'), json(manifest))
  console.log(json({ version, summaryBytes: summary.bytes, municipalityBytes: Object.fromEntries(Object.entries(municipalities).map(([key, value]) => [key, value.bytes])), provenanceBytes: provenance.bytes, sourceFiles: captures.size }))
}

export function reconcileComparisons(parent: RoundComparison, children: RoundComparison[], label: string) {
  const sum = (values: number[]) => values.reduce((a, b) => {
    const value = a + b
    if (!Number.isSafeInteger(value)) throw new Error('Soma fora do intervalo seguro.')
    return value
  }, 0)
  for (const round of ['first', 'second'] as const) {
    for (const key of ['totalVotes', 'validVotes', 'blankVotes', 'nullVotes', 'otherVotes'] as const) {
      if (parent[round][key] !== sum(children.map((item) => item[round][key]))) throw new Error(`${label}:${round}:${key}: reconciliação falhou`)
    }
    for (const key of ['total', 'counted'] as const) {
      if (parent[round].sections[key] !== sum(children.map((item) => item[round].sections[key]))) throw new Error(`${label}: seções`)
    }
    for (const id of Object.keys(parent[round].votes)) {
      if (parent[round].votes[id] !== sum(children.map((item) => item[round].votes[id]!))) throw new Error(`${label}: candidato ${id}`)
    }
  }
}

async function validateManifest(input: unknown, root = outputRoot) {
  const { parseDatasetManifest, parseDatasetSummary, parseMunicipalityShard } = await import('../src/data/comparison')
  const manifest = parseDatasetManifest(input)
  const resource = async (entry: { path: string; sha256: string; bytes: number }) => {
    const bytes = await readFile(join(root, ...entry.path.split('/')))
    if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`Hash/tamanho inválido: ${entry.path}`)
    return JSON.parse(bytes.toString('utf8')) as unknown
  }
  const summary = parseDatasetSummary(await resource(manifest.summary), manifest)
  const byId = new Map(summary.comparisons.map((item) => [item.geography.id, item]))
  const get = (id: string) => {
    const item = byId.get(id)
    if (!item) throw new Error(`Geografia ausente: ${id}`)
    return item
  }
  for (const [state, entry] of Object.entries(manifest.municipalities)) {
    const shard = parseMunicipalityShard(await resource(entry), { manifest, summary }, state)
    reconcileComparisons(get(`state:${state}`), shard.comparisons, state)
  }
  reconcileComparisons(get('domestic'), summary.metadata.states.map(({ code }) => get(`state:${code}`)), 'Brasil')
  reconcileComparisons(get('overseas'), summary.metadata.countries.map(({ code }) => get(`country:${code}`)), 'Exterior')
  reconcileComparisons(get('overall'), [get('domestic'), get('overseas')], 'Total geral')
  const provenance = z.object({
    schemaVersion: z.literal(1), version: z.literal(manifest.version), generatedAt: z.literal(manifest.generatedAt),
    origin: z.literal(TSE_ORIGIN),
    trustKey: z.object({
      kty: z.literal(TSE_PUBLIC_JWK.kty), use: z.literal(TSE_PUBLIC_JWK.use),
      key_ops: z.tuple([z.literal('verify')]), alg: z.literal(TSE_PUBLIC_JWK.alg),
      kid: z.literal(TSE_PUBLIC_JWK.kid), crv: z.literal(TSE_PUBLIC_JWK.crv), x: z.literal(TSE_PUBLIC_JWK.x),
    }),
    countryMapping: z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
    coverage: z.object({
      resultFiles: z.literal(11572), received: z.literal(11572),
      perRound: z.object({
        states: z.literal(27), domesticMunicipalities: z.literal(5571),
        overseasLocalities: z.literal(186), countries: z.literal(133),
      }),
    }),
    reconciliation: z.object({
      municipalitiesToStates: z.literal(true), overseasLocalitiesToZZ: z.literal(true),
      statesAndZZToNational: z.literal(true), allCandidateVotesToValidVotes: z.literal(true), allResultsFinal: z.literal(true),
    }),
    captures: z.array(z.object({
      path: z.string(), url: z.string().url(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
      payloadSha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive(),
      collectedAt: z.string().datetime(),
    })).length(11575),
  }).parse(await resource(manifest.provenance))
  if (summary.metadata.states.flatMap((state) => state.municipalities).length !== 5571 ||
    summary.metadata.overseasMunicipalities.length !== 186 || summary.metadata.countries.length !== 133) {
    throw new Error('Inventário não corresponde à cobertura presidencial revisada de 2026.')
  }
  if (provenance.countryMapping.sha256 !== sha256(json(countryMapping))) throw new Error('Mapeamento mudou após importação.')
  const expectedPaths = new Set([
    '/oficial/comum/config/ele-c.jws',
    ...[summary.elections.first, summary.elections.second].flatMap((election) => {
      const data = { ...summary.metadata, election }
      return [
        `/oficial/${election.cycle}/${election.id}/config/mun-e${election.id.padStart(6, '0')}-cm.jws`,
        resultPath(data, 'br'), resultPath(data, 'zz'),
        ...data.states.flatMap((state) => [
          resultPath(data, state.code),
          ...state.municipalities.map((city) => resultPath(data, state.code, city.code)),
        ]),
        ...data.overseasMunicipalities.map((city) => resultPath(data, 'zz', city.code)),
      ]
    }),
  ])
  for (const item of provenance.captures) {
    if (!expectedPaths.delete(item.path) || item.url !== `${TSE_ORIGIN}${item.path}`) throw new Error('Captura ausente, duplicada ou desconhecida.')
    if (Date.parse(item.collectedAt) > Date.parse(manifest.generatedAt)) throw new Error('Captura posterior à geração do conjunto.')
  }
  if (expectedPaths.size !== 0) throw new Error('Capturas incompletas.')
  return manifest
}

export async function run(mode: string, captureName?: string) {
  if (captureName !== undefined && mode !== 'import') throw new Error('--capture só se aplica à importação.')
  cacheRoot = captureDirectory(captureName)
  if (mode === 'import') await generate()
  else if (mode === 'validate') {
    const manifest = await validateManifest(JSON.parse(await readFile(join(outputRoot, 'manifest.json'), 'utf8')))
    console.log(`Validated offline: ${manifest.version}, ${Object.keys(manifest.municipalities).length} municipality shards.`)
  } else throw new Error(`Comando desconhecido: ${mode}`)
}
