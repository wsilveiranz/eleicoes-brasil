export type Selection =
  | { scope: 'overall' }
  | { scope: 'domestic'; state?: string; municipality?: string }
  | { scope: 'overseas'; country?: string }

export class SelectionError extends Error {
  constructor() {
    super('O endereço contém uma localidade inválida. Escolha uma opção de navegação.')
    this.name = 'SelectionError'
  }
}

export function parseSelection(search: string): Selection {
  const params = new URLSearchParams(search)
  for (const key of ['visao', 'uf', 'municipio', 'pais']) {
    if (params.getAll(key).length > 1) throw new SelectionError()
  }
  const scope = params.get('visao') ?? 'geral'
  const state = params.get('uf')
  const municipality = params.get('municipio')
  const country = params.get('pais')
  if (scope === 'geral' && state === null && municipality === null && country === null) {
    return { scope: 'overall' }
  }
  if (scope === 'brasil' && country === null) {
    if (state !== null && !/^[a-z]{2}$/.test(state)) throw new SelectionError()
    if (municipality !== null && (!state || !/^\d{5}$/.test(municipality))) {
      throw new SelectionError()
    }
    return {
      scope: 'domestic',
      ...(state !== null ? { state } : {}),
      ...(municipality !== null ? { municipality } : {}),
    }
  }
  if (
    scope === 'exterior' &&
    state === null &&
    municipality === null &&
    (country === null || /^[a-zA-Z0-9_-]{1,24}$/.test(country))
  ) {
    return { scope: 'overseas', ...(country !== null ? { country } : {}) }
  }
  throw new SelectionError()
}

export function selectionSearch(selection: Selection): string {
  const params = new URLSearchParams()
  if (selection.scope === 'domestic') {
    params.set('visao', 'brasil')
    if (selection.state) params.set('uf', selection.state)
    if (selection.municipality) params.set('municipio', selection.municipality)
  } else if (selection.scope === 'overseas') {
    params.set('visao', 'exterior')
    if (selection.country) params.set('pais', selection.country)
  }
  return params.size === 0 ? '' : `?${params.toString()}`
}

export function selectionId(selection: Selection): string {
  if (selection.scope === 'overall') return 'overall'
  if (selection.scope === 'overseas') {
    return selection.country ? `country:${selection.country}` : 'overseas'
  }
  if (selection.municipality) {
    return `municipality:${selection.state}:${selection.municipality}`
  }
  return selection.state ? `state:${selection.state}` : 'domestic'
}
