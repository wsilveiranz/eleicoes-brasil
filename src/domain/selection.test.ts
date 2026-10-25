import { describe, expect, it } from 'vitest'
import { parseSelection, selectionId, selectionSearch, type Selection } from './selection'

describe('geography query strings', () => {
  it.each<Selection>([
    { scope: 'overall' },
    { scope: 'domestic' },
    { scope: 'domestic', state: 'df' },
    { scope: 'domestic', state: 'sp', municipality: '71072' },
    { scope: 'overseas' },
    { scope: 'overseas', country: 'PT' },
  ])('round trips a valid selection: %j', (selection) => {
    expect(parseSelection(selectionSearch(selection))).toEqual(selection)
    expect(selectionId(selection)).not.toBe('')
  })

  it.each([
    '?visao=other',
    '?municipio=71072',
    '?visao=brasil&municipio=71072',
    '?visao=brasil&uf=SP',
    '?visao=brasil&uf=sp&municipio=123',
    '?visao=brasil&pais=PT',
    '?visao=exterior&uf=sp',
    '?visao=exterior&pais=',
    '?visao=brasil&uf=sp&uf=df',
  ])('rejects invalid navigation instead of silently showing another geography: %s', (search) => {
    expect(() => parseSelection(search)).toThrow(/endereço/)
  })
})
