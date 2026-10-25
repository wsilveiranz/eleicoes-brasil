import { QueryClient } from '@tanstack/react-query'
import { retryDelay, shouldRetry } from '../data/tse/http'

export function createAppQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: true,
      },
    },
  })

  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'observerRemoved' && event.type !== 'updated') return
    const results = client.getQueryCache().findAll({
      predicate: (query) => query.meta?.liveResult === true,
    })
    let excess = results.length - 100
    if (excess <= 0) return
    // New queries exist during render before their first observer subscribes.
    const inactive = results
      .filter((query) =>
        query.getObserversCount() === 0 &&
        query.state.fetchStatus === 'idle' &&
        query.state.status !== 'pending',
      )
      .sort(
        (a, b) =>
          Math.max(a.state.dataUpdatedAt, a.state.errorUpdatedAt) -
          Math.max(b.state.dataUpdatedAt, b.state.errorUpdatedAt),
      )
    for (const query of inactive) {
      if (excess-- <= 0) break
      client.getQueryCache().remove(query)
    }
  })

  return client
}
