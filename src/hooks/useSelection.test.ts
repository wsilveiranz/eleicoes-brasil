import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { navigate, useSelection } from './useSelection'

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
})
