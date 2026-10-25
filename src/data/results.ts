import type { ElectionMetadata } from '../domain/geography'
import { aggregateResults, type Geography, type ResultSnapshot } from '../domain/results'
import { SelectionError, type Selection } from '../domain/selection'
import { loadDirectResult, OfficialValidationError } from './tse/client'

const domesticStates = new Set(
  'ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' '),
)

interface Location {
  state: string
  municipality?: string
}

async function loadAggregate(
  metadata: ElectionMetadata,
  geography: Geography,
  locations: Location[],
  signal: AbortSignal,
): Promise<ResultSnapshot> {
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  try {
    const snapshots = await Promise.all(
      locations.map((location) => loadDirectResult(metadata, location, combined)),
    )
    combined.throwIfAborted()
    return aggregateResults(
      geography,
      locations.map(({ state, municipality }) =>
        municipality === undefined ? `state:${state}` : `municipality:${state}:${municipality}`,
      ),
      snapshots,
    )
  } catch (error) {
    controller.abort(error)
    throw error
  }
}

export async function loadSelectionResult(
  metadata: ElectionMetadata,
  selection: Selection,
  signal: AbortSignal,
): Promise<ResultSnapshot> {
  signal.throwIfAborted()
  if (selection.scope === 'overall') {
    return loadDirectResult(metadata, { state: 'br' }, signal)
  }
  if (selection.scope === 'domestic') {
    if (selection.state !== undefined) {
      if (!domesticStates.has(selection.state)) throw new SelectionError()
      return loadDirectResult(metadata, {
        state: selection.state,
        ...(selection.municipality !== undefined ? { municipality: selection.municipality } : {}),
      }, signal)
    }
    if (selection.municipality !== undefined) throw new SelectionError()
    const codes = metadata.states.map((state) => state.code)
    if (
      codes.length !== domesticStates.size ||
      new Set(codes).size !== domesticStates.size ||
      codes.some((code) => !domesticStates.has(code))
    ) {
      throw new OfficialValidationError('Inventário incompleto ou inválido das 27 UFs brasileiras.')
    }
    return loadAggregate(metadata, { id: 'domestic', kind: 'domestic', label: 'Brasil' },
      codes.map((state) => ({ state })), signal)
  }
  if (selection.scope === 'overseas') {
    if (selection.country === undefined) {
      return loadDirectResult(metadata, { state: 'zz' }, signal)
    }
    const matches = metadata.countries.filter((country) => country.code === selection.country)
    if (matches.length === 0) throw new SelectionError()
    if (matches.length !== 1) throw new OfficialValidationError('País duplicado nos metadados.')
    const country = matches[0]!
    const codes = country.municipalities.map((city) => city.code)
    if (
      codes.length === 0 ||
      new Set(codes).size !== codes.length ||
      codes.some((code) => !metadata.overseasMunicipalities.some((city) => city.code === code))
    ) {
      throw new OfficialValidationError('Mapeamento de localidades do país vazio, duplicado ou desconhecido.')
    }
    return loadAggregate(metadata, {
      id: `country:${country.code}`, kind: 'country', label: country.name,
    }, codes.map((municipality) => ({ state: 'zz', municipality })), signal)
  }
  throw new SelectionError()
}
