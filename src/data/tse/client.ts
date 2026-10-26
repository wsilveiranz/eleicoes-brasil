import type { ElectionMetadata } from '../../domain/geography'
import type { Geography, ResultSnapshot } from '../../domain/results'
import { assertCount } from '../../domain/results'
import countryMapping from '../geography/countries.json'
import { fetchOfficialText } from './http'
import {
  countryMappingSchema,
  discoverySchema,
  municipalitySchema,
  resultEnvelopeSchema,
  resultSchema,
} from './schemas'
import {
  AwaitingPublicationError,
  OfficialValidationError,
  parseSource,
  sourceDate,
  sourceTimestamp,
  verifyOfficialJws,
} from './validation'

export { AwaitingPublicationError, OfficialValidationError } from './validation'

const domesticStates = new Set(
  'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' '),
)

function unique(values: string[], field: string) {
  if (new Set(values).size !== values.length) {
    throw new OfficialValidationError(`${field}: identificadores duplicados.`)
  }
}

export function discoverElection(payload: unknown, round: '1' | '2' = '2'): ElectionMetadata['election'] {
  const source = parseSource(discoverySchema, payload)
  const matches = source.pl.flatMap((cycle) =>
    cycle.e.filter((election) =>
      cycle.c === 'ele2026' &&
      election.t === round &&
      election.abr.some((scope) =>
        scope.cd === 'br' && scope.cp.some((office) => office.cd === '1'),
      ),
    ).map((election) => ({ cycle, election })),
  )
  if (matches.length !== 1) {
    throw new AwaitingPublicationError(`Eleição presidencial de 2026, turno ${round}, ausente ou ambígua.`)
  }
  const match = matches[0]!
  const date = sourceDate(match.cycle.dt)
  if (!date.startsWith('2026-')) throw new OfficialValidationError('Ano da eleição inconsistente.')
  return {
    id: match.election.cd,
    cycle: match.cycle.c,
    name: match.election.nm,
    date,
    year: 2026,
    round,
  }
}

export function normalizeMetadata(
  election: ElectionMetadata['election'],
  payload: unknown,
  mapping: unknown = countryMapping,
): ElectionMetadata {
  const source = parseSource(municipalitySchema, payload)
  const countries = parseSource(countryMappingSchema, mapping)
  const reviewedFirstRound = countries.election === '6258' && election.id === '6257' &&
    countries.cycle === 'ele2026' && election.round === '1'
  if ((countries.election !== election.id && !reviewedFirstRound) || countries.cycle !== election.cycle) {
    throw new OfficialValidationError('O mapeamento oficial de países não cobre esta eleição.')
  }
  unique(source.abr.map((state) => state.cd), 'UF')
  if (
    source.abr.length !== domesticStates.size + 1 ||
    !source.abr.some((state) => state.cd === 'zz') ||
    [...domesticStates].some((code) => !source.abr.some((state) => state.cd === code))
  ) {
    throw new OfficialValidationError('Inventário incompleto de UFs: são necessários os 26 estados, DF e ZZ.')
  }
  for (const state of source.abr) unique(state.mu.map((city) => city.cd), `Municípios de ${state.cd}`)
  const overseasMunicipalities = source.abr.find((state) => state.cd === 'zz')!.mu
    .map((city) => ({ code: city.cd, name: city.nm }))
  const overseas = new Map(overseasMunicipalities.map((city) => [city.code, city]))
  const mappedCodes = countries.countries.flatMap((country) => country.localityCodes)
  unique(countries.countries.map((country) => country.id), 'Países')
  unique(mappedCodes, 'Localidades no mapeamento de países')
  if (
    countries.coverage.expected !== overseas.size ||
    countries.coverage.mapped !== mappedCodes.length ||
    countries.coverage.unique !== new Set(mappedCodes).size ||
    mappedCodes.length !== overseas.size ||
    mappedCodes.some((code) => !overseas.has(code))
  ) {
    throw new OfficialValidationError('Cobertura incompleta ou desconhecida no mapeamento oficial de países.')
  }
  return {
    election,
    states: source.abr.filter((state) => state.cd !== 'zz').map((state) => ({
      code: state.cd,
      name: state.ds,
      municipalities: state.mu.map((city) => ({ code: city.cd, name: city.nm })),
    })),
    overseasMunicipalities,
    countries: countries.countries.map((country) => ({
      code: country.id,
      name: country.name,
      municipalities: country.localityCodes.map((code) => overseas.get(code)!),
    })),
  }
}

export async function loadMetadata(signal: AbortSignal, round: '1' | '2' = '2'): Promise<ElectionMetadata> {
  const discovery = await verifyOfficialJws(await fetchOfficialText('/oficial/comum/config/ele-c.jws', signal))
  signal.throwIfAborted()
  const election = discoverElection(discovery, round)
  const path = `/oficial/${election.cycle}/${election.id}/config/mun-e${election.id.padStart(6, '0')}-cm.jws`
  const municipalities = await verifyOfficialJws(await fetchOfficialText(path, signal))
  signal.throwIfAborted()
  return normalizeMetadata(election, municipalities)
}

interface DirectLocation { state: string; municipality?: string }

function requestedGeography(metadata: ElectionMetadata, location: DirectLocation): Geography {
  const { state, municipality } = location
  if (!/^[a-z]{2}$/.test(state)) throw new OfficialValidationError('UF solicitada inválida.')
  if (state === 'br') {
    if (municipality !== undefined) throw new OfficialValidationError('Município não pertence ao escopo BR.')
    return { id: 'overall', kind: 'overall', label: 'Total geral' }
  }
  const stateMetadata = metadata.states.find((item) => item.code === state)
  if (state !== 'zz' && !stateMetadata) throw new OfficialValidationError('UF não pertence à eleição.')
  if (municipality !== undefined) {
    const cities = state === 'zz' ? metadata.overseasMunicipalities : stateMetadata!.municipalities
    const city = cities.find((item) => item.code === municipality)
    if (!/^\d{5}$/.test(municipality) || !city) {
      throw new OfficialValidationError('Município não pertence à UF solicitada.')
    }
    return { id: `municipality:${state}:${municipality}`, kind: 'municipality', label: city.name }
  }
  return state === 'zz'
    ? { id: 'overseas', kind: 'overseas', label: 'Exterior' }
    : { id: `state:${state}`, kind: 'state', label: stateMetadata!.name }
}

export function normalizeResult(
  payload: unknown,
  metadata: ElectionMetadata,
  location: DirectLocation,
  fetchedAt = new Date().toISOString(),
): ResultSnapshot {
  const geography = requestedGeography(metadata, location)
  const envelope = parseSource(resultEnvelopeSchema, payload)
  const expectedType = location.municipality !== undefined ? 'mu' : location.state === 'br' ? 'br' : 'uf'
  if (
    envelope.ele !== metadata.election.id || envelope.t !== metadata.election.round || envelope.f !== 'o' ||
    envelope.tpabr !== expectedType || envelope.cdabr !== (location.municipality ?? location.state) ||
    envelope.carg.length !== 1 || envelope.carg[0]?.cd !== '1'
  ) {
    throw new OfficialValidationError('Eleição, turno, ambiente, cargo ou geografia oficial não corresponde à solicitação.')
  }
  if (envelope.dv !== 's' && envelope.dv !== 'S') throw new AwaitingPublicationError()
  const result = parseSource(resultSchema, payload)
  for (const group of result.carg[0]!.agr) {
    for (const party of group.par) {
      for (const candidate of party.cand) {
        if (candidate.dvt !== undefined && candidate.dvt !== 'Válido') {
          throw new OfficialValidationError(`Destino de votos não revisado: ${candidate.dvt}.`)
        }
      }
    }
  }
  const candidates = result.carg[0]!.agr.flatMap((group) =>
    group.par.flatMap((party) => party.cand.map((candidate) => ({
      id: candidate.sqcand,
      number: candidate.n,
      name: candidate.nmu,
      party: party.sg,
      votes: candidate.vap,
      elected: candidate.e === 's' || candidate.e === 'S',
    }))),
  )
  if (candidates.length === 0) throw new OfficialValidationError('Candidatos ausentes.')
  unique(candidates.map((candidate) => candidate.id), 'Candidatos')
  unique(candidates.map((candidate) => candidate.number), 'Números de candidatos')
  const sum = (values: number[]) => values.reduce((a, b) => assertCount(a + b, 'soma oficial'), 0)
  const { tv, vv, vb, tvn, vvc, vn, vnt } = result.v
  const candidateVotes = sum(candidates.map((candidate) => candidate.votes))
  if (
    result.s.st > result.s.ts ||
    (result.s.snt !== undefined && sum([result.s.st, result.s.snt]) !== result.s.ts) ||
    // Annulled votes can be separate from the displayed candidate tallies.
    vv > vvc || candidateVotes !== vv ||
    candidates.some((candidate) => candidate.votes > vv) ||
    sum([vvc, vb, tvn]) !== tv ||
    (vn !== undefined && vnt !== undefined && sum([vn, vnt]) !== tvn)
  ) {
    throw new OfficialValidationError('Contagens oficiais inconsistentes.')
  }
  const timestamp = sourceTimestamp(result.dg, result.hg)
  return {
    electionId: result.ele,
    geography,
    candidates,
    totalVotes: tv,
    validVotes: vv,
    blankVotes: vb,
    nullVotes: tvn,
    sections: { total: result.s.ts, counted: result.s.st },
    countingComplete: result.tf === 's' || result.tf === 'S',
    sourceTimes: { oldest: timestamp, latest: timestamp },
    fetchedAt,
    coverage: { received: 1, expected: 1 },
  }
}

export async function loadDirectResult(
  metadata: ElectionMetadata,
  location: { state: string; municipality?: string },
  signal: AbortSignal,
): Promise<ResultSnapshot> {
  requestedGeography(metadata, location)
  if (!/^ele2026$/.test(metadata.election.cycle) || !/^\d+$/.test(metadata.election.id) ||
    !['1', '2'].includes(metadata.election.round) || metadata.election.year !== 2026) {
    throw new OfficialValidationError('Metadados da eleição inválidos.')
  }
  const { state, municipality } = location
  const election = metadata.election
  const path = `/oficial/${election.cycle}/${election.id}/dados/${state}/${state}${municipality ?? ''}-c0001-e${election.id.padStart(6, '0')}-u.jws`
  const payload = await verifyOfficialJws(await fetchOfficialText(path, signal))
  signal.throwIfAborted()
  return normalizeResult(payload, metadata, location)
}
