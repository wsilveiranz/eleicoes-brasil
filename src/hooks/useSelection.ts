import { useMemo, useSyncExternalStore } from 'react'
import {
  parseSelection,
  SelectionError,
  selectionSearch,
  type Selection,
} from '../domain/selection'

const navigationEvent = 'election:navigate'

function subscribe(listener: () => void) {
  window.addEventListener('popstate', listener)
  window.addEventListener(navigationEvent, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(navigationEvent, listener)
  }
}

export function navigate(selection: Selection) {
  const url = new URL(window.location.href)
  url.search = selectionSearch(selection)
  window.history.pushState(null, '', url)
  window.dispatchEvent(new Event(navigationEvent))
}

export function useSelection() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => '')
  return useMemo(() => {
    try {
      return { selection: parseSelection(search), error: null, navigate }
    } catch (error) {
      if (!(error instanceof SelectionError)) throw error
      return { selection: null, error, navigate }
    }
  }, [search])
}
