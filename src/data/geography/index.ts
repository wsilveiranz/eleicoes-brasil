import mapping from './countries.json';

export interface OverseasCountry {
  id: string;
  name: string;
  localityCodes: string[];
}

export interface OverseasLocality {
  code: string;
  name: string;
  countryId: string;
  countryName: string;
  sourceCity: string;
  source: string;
  workbook: string;
  sheet: string;
  row: number;
  match: string;
}

export const countries: OverseasCountry[] = mapping.countries;
export const overseasLocalities: OverseasLocality[] = mapping.localities;
export const countryMappingProvenance = {
  metadataSource: mapping.metadataSource,
  sourcePage: mapping.sourcePage,
  coverage: mapping.coverage,
  classificationNote: mapping.classificationNote,
};

/** Refuse drift rather than silently dropping new or duplicated overseas codes. */
export function assertCountryMappingCoverage(codes: readonly string[]): void {
  const expected = new Set(codes);
  const mapped = new Set(overseasLocalities.map((locality) => locality.code));
  if (
    expected.size !== codes.length ||
    mapped.size !== overseasLocalities.length ||
    expected.size !== mapped.size ||
    codes.some((code) => !mapped.has(code))
  ) {
    throw new Error('A cobertura oficial de países não corresponde às localidades do TSE.');
  }
}
