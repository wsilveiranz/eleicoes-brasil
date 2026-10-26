import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { verifyOfficialJws } from '../src/data/tse/validation'
import { sourceCount } from '../src/data/tse/schemas'
import { parseDatasetManifest, parseDatasetSummary } from '../src/data/comparison'
import { parseParticipation, type Turnout } from '../src/data/statistics'
import { regions } from '../src/domain/regions'

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const envelope = z.object({
  ele: z.string(), t: z.string(), f: z.literal('o'), dv: z.enum(['s', 'S']), tf: z.enum(['s', 'S']),
  tpabr: z.string(), cdabr: z.string(),
  e: z.object({ te: sourceCount, c: sourceCount, a: sourceCount, esi: sourceCount, esni: sourceCount }),
})
const evidence = z.object({
  captures: z.array(z.object({ path: z.string(), url: z.string(), sha256: z.string() })),
})

export async function run() {
  const root = join('public', 'data', '2026')
  const manifest = parseDatasetManifest(JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')))
  const summaryRaw = await readFile(join(root, manifest.summary.path))
  const provenanceRaw = await readFile(join(root, manifest.provenance.path))
  if (digest(summaryRaw) !== manifest.summary.sha256 || digest(provenanceRaw) !== manifest.provenance.sha256) {
    throw new Error('Published capture integrity mismatch')
  }
  const summary = parseDatasetSummary(JSON.parse(summaryRaw.toString()), manifest)
  const provenance = evidence.parse(JSON.parse(provenanceRaw.toString()))
  const sources = []
  const rounds = []
  for (const [round, electionId] of [['1', '6257'], ['2', '6258']] as const) {
    const values = new Map<string, Turnout>()
    for (const state of ['br', 'zz', ...summary.metadata.states.map(({ code }) => code)]) {
      const path = `/oficial/ele2026/${electionId}/dados/${state}/${state}-c0001-e${electionId.padStart(6, '0')}-u.jws`
      const capture = provenance.captures.find((source) => source.path === path)
      if (!capture) throw new Error(`Missing capture ${path}`)
      const token = await readFile(join('.tse-import-cache', '2026', ...path.split('/').filter(Boolean)), 'utf8')
      if (digest(token) !== capture.sha256) throw new Error(`Capture differs from published version: ${path}`)
      const payload = envelope.parse(await verifyOfficialJws(token))
      if (payload.ele !== electionId || payload.t !== round || payload.cdabr !== state ||
        payload.tpabr !== (state === 'br' ? 'br' : 'uf')) throw new Error(`Turnout source identity mismatch: ${path}`)
      const { te, c, a, esi, esni } = payload.e
      if (c + a !== esi || esi + esni !== te) throw new Error(`Turnout denominator mismatch: ${path}`)
      values.set(state, { eligible: te, attended: c, abstained: a, unreported: esni })
      sources.push({ url: capture.url, sha256: capture.sha256 })
    }
    function sum(codes: readonly string[]): Turnout {
      const result: Turnout = { eligible: 0, attended: 0, abstained: 0, unreported: 0 }
      for (const code of codes) for (const key of Object.keys(result) as (keyof Turnout)[]) {
        const value = values.get(code)
        if (!value) throw new Error(`Missing UF: ${code}`)
        result[key] += value[key]
      }
      return result
    }
    rounds.push({
      electionId, overall: values.get('br'), overseas: values.get('zz'),
      domestic: sum(summary.metadata.states.map(({ code }) => code)),
      regions: Object.fromEntries(regions.map(({ id, states }) => [id, sum(states)])),
    })
  }
  const data = parseParticipation({
    schemaVersion: 1, datasetVersion: manifest.version, generatedAt: new Date().toISOString(),
    first: rounds[0], second: rounds[1], sources,
  }, manifest.version)
  await writeFile(join(root, 'participation.json'), JSON.stringify(data) + '\n')
  console.log(JSON.stringify({ first: data.first.overall, second: data.second.overall, sources: sources.length }))
}
