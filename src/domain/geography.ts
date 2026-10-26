export interface MunicipalityMetadata {
  /** Official TSE municipality code, preserved as a five-digit string. */
  code: string
  name: string
}

export interface StateMetadata {
  /** Lowercase two-letter UF, matching Selection.state. */
  code: string
  name: string
  municipalities: MunicipalityMetadata[]
}

export interface CountryMetadata {
  /** Official country ID or stable government-derived code: 1–24 letters, digits, "_" or "-"; not necessarily ISO. */
  code: string
  name: string
  municipalities: MunicipalityMetadata[]
}

export interface ElectionMetadata {
  election: {
    id: string
    cycle: string
    name: string
    /** ISO calendar date (YYYY-MM-DD). */
    date: string
    year: number
    round: '1' | '2'
  }
  states: StateMetadata[]
  countries: CountryMetadata[]
  /** Full overseas voting-location inventory, for country-mapping coverage checks. */
  overseasMunicipalities: MunicipalityMetadata[]
}

export function normalizeGeographySearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
}
