import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { navigate, navigateArea, useSelection } from './useSelection'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('useSelection', () => {
  it('navigates without a server route and preserves a static-host subpath', () => {
    window.history.replaceState(null, '', '/elections/')
    const { result } = renderHook(useSelection)
    expect(result.current.selection).toEqual({ scope: 'overall' })
    act(() => navigate({ scope: 'domestic', state: 'df' }))
    expect(window.location.pathname).toBe('/elections/')
    expect(window.location.search).toBe('?visao=brasil&uf=df')
    expect(result.current.selection).toEqual({ scope: 'domestic', state: 'df' })
  })

  it('responds to browser history navigation', () => {
    const { result } = renderHook(useSelection)
    act(() => {
      window.history.replaceState(null, '', '/?visao=exterior&pais=PT')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current.selection).toEqual({ scope: 'overseas', country: 'PT' })
  })

  it('reports malformed links until explicitly navigated away', () => {
    window.history.replaceState(null, '', '/?visao=brasil&municipio=12345')
    const { result } = renderHook(useSelection)
    expect(result.current.selection).toBeNull()
    expect(result.current.error?.message).toMatch(/endereço/)
    act(() => result.current.navigate({ scope: 'overall' }))
    expect(result.current.error).toBeNull()
  })

  it('shares the statistics area while retaining geography and handles history without server routing', () => {
    window.history.replaceState(null, '', '/elections/?visao=brasil&uf=sp')
    const { result } = renderHook(useSelection)
    act(() => navigateArea('statistics'))
    expect(window.location.pathname).toBe('/elections/')
    expect(window.location.search).toBe('?visao=brasil&uf=sp&area=estatisticas')
    expect(result.current.area).toBe('statistics')
    expect(result.current.selection).toEqual({ scope: 'domestic', state: 'sp' })
    act(() => navigateArea('results'))
    expect(window.location.search).toBe('?visao=brasil&uf=sp')
    expect(result.current.area).toBe('results')
    act(() => {
      window.history.replaceState(null, '', '/elections/?area=estatisticas')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(result.current.area).toBe('statistics')
  })

  it.each(['?area=wrong', '?area=estatisticas&area=estatisticas'])('rejects an invalid area: %s', (search) => {
    window.history.replaceState(null, '', `/${search}`)
    const { result } = renderHook(useSelection)
    expect(result.current.error).not.toBeNull()
  })
})
