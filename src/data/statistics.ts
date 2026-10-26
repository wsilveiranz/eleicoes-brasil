import { z } from 'zod'
import { ResultDataError } from '../domain/results'
import { regions } from '../domain/regions'
import { groupAgeBands } from '../domain/statistics'

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const time = z.iso.datetime({ offset: true })
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const turnout = z.strictObject({
  eligible: count, attended: count, abstained: count, unreported: count,
}).superRefine((value, context) => {
  if (value.attended + value.abstained + value.unreported !== value.eligible) {
    context.addIssue({ code: 'custom', message: 'Comparecimento, abstenção e sem informação não reconciliam.' })
  }
})
const round = z.strictObject({
  electionId: z.enum(['6257', '6258']),
  overall: turnout, domestic: turnout, overseas: turnout,
  regions: z.record(z.string(), turnout),
})
const participationSchema = z.strictObject({
  schemaVersion: z.literal(1), datasetVersion: z.string().min(1), generatedAt: time,
  first: round, second: round,
  sources: z.array(z.strictObject({
    url: z.string().url().startsWith('https://resultados.tse.jus.br/oficial/'),
    sha256: hash,
  })).length(58),
})
const ageBand = z.strictObject({
  code: z.string().min(1), label: z.string().min(1),
  eligible: count, attended: count, abstained: count,
}).superRefine((value, context) => {
  if (value.attended + value.abstained !== value.eligible) {
    context.addIssue({ code: 'custom', message: 'Totais por idade não reconciliam.' })
  }
})
const ageRound = z.strictObject({
  status: z.enum(['available', 'not-published', 'incomplete']),
  sourceGeneratedAt: time.nullable(),
  states: z.array(z.string().regex(/^[A-Z]{2}$/)),
  bands: z.array(ageBand),
})
const ageSchema = z.strictObject({
  schemaVersion: z.literal(1), year: z.literal(2026),
  checkedAt: time, lastSuccessAt: time.nullable(), dataUpdatedAt: time.nullable(),
  refresh: z.enum(['ok', 'error']), error: z.string().nullable(),
  source: z.literal('https://cdn.tse.jus.br/estatistica/sead/odsele/perfil_comparecimento_abstencao/perfil_comparecimento_abstencao_2026.zip'),
  etag: z.string().nullable(), lastModified: z.string().nullable(), sha256: hash.nullable(),
  first: ageRound, second: ageRound,
})
export type ParticipationData = z.infer<typeof participationSchema>
export type Turnout = z.infer<typeof turnout>
export type AgeData = z.infer<typeof ageSchema>
export type AgeBand = z.infer<typeof ageBand>

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ResultDataError(message)
}

export function parseParticipation(value: unknown, datasetVersion: string): ParticipationData {
  const parsed = participationSchema.safeParse(value)
  if (!parsed.success) throw new ResultDataError('Formato ou totais de participação inválidos.')
  const data = parsed.data
  check(data.datasetVersion === datasetVersion, 'Participação pertence a outra versão dos resultados.')
  check(data.first.electionId === '6257' && data.second.electionId === '6258', 'Turnos de participação inconsistentes.')
  check(new Set(data.sources.map(({ url }) => url)).size === 58, 'Fontes de participação duplicadas.')
  for (const round of [data.first, data.second]) {
    check(Object.keys(round.regions).length === 5 && regions.every(({ id }) => round.regions[id]),
      'Cobertura regional de participação incompleta.')
    for (const key of ['eligible', 'attended', 'abstained', 'unreported'] as const) {
      check(regions.reduce((sum, { id }) => sum + round.regions[id]![key], 0) === round.domestic[key],
        'Regiões não reconciliam com Brasil.')
      check(round.domestic[key] + round.overseas[key] === round.overall[key],
        'Brasil e exterior não reconciliam com total geral.')
    }
  }
  return data
}

export function parseAgeData(value: unknown): AgeData {
  const parsed = ageSchema.safeParse(value)
  if (!parsed.success) throw new ResultDataError('Formato ou totais do perfil etário inválidos.')
  const data = parsed.data
  check(data.refresh === 'error' ? Boolean(data.error) : data.error === null, 'Estado da atualização etária inconsistente.')
  check(data.lastSuccessAt === null || Date.parse(data.lastSuccessAt) <= Date.parse(data.checkedAt),
    'Datas da atualização etária inconsistentes.')
  check(data.lastSuccessAt === null || (data.sha256 !== null && data.dataUpdatedAt !== null), 'Proveniência etária ausente.')
  const states = [...regions.flatMap(({ states }) => [...states]), 'zz'].map((state) => state.toUpperCase())
  for (const round of [data.first, data.second]) {
    check(new Set(round.states).size === round.states.length && round.states.every((state) => states.includes(state)),
      'Inventário etário inválido.')
    check(new Set(round.bands.map(({ code }) => code)).size === round.bands.length, 'Faixas etárias duplicadas.')
    if (round.status === 'available') {
      check(round.states.length === 28 && round.bands.length > 0 && round.sourceGeneratedAt !== null &&
        data.sha256 !== null && data.lastSuccessAt !== null, 'Cobertura ou proveniência etária incompleta.')
      check(Date.parse(round.sourceGeneratedAt) >= Date.parse(round === data.first ? '2026-10-04' : '2026-10-25'),
        'Data do perfil etário anterior ao turno.')
      groupAgeBands(round.bands)
    } else {
      check(round.bands.length === 0, 'Perfil etário parcial não pode ser apresentado como completo.')
      check(round.status !== 'not-published' || round.states.length === 0, 'Publicação etária inconsistente.')
    }
  }
  return data
}

async function loadJson(file: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/2026/${file}`, { signal, cache: 'no-cache' })
  if (!response.ok) throw new ResultDataError(`Não foi possível carregar as estatísticas (HTTP ${response.status}).`)
  return response.json()
}

export async function loadParticipation(version: string, signal: AbortSignal) {
  return parseParticipation(await loadJson('participation.json', signal), version)
}

export async function loadAgeData(signal: AbortSignal) {
  return parseAgeData(await loadJson('age-turnout.json', signal))
}
