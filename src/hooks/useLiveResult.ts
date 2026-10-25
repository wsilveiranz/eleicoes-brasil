import { useCallback, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { OfficialRequestError, retryDelay, shouldRetry } from '../data/tse/http'
import type { ResultSnapshot } from '../domain/results'

const POLL_MS = 30_000

export function useLiveResult(
  queryKey: readonly string[],
  load: (signal: AbortSignal) => Promise<ResultSnapshot>,
  enabled = true,
): UseQueryResult<ResultSnapshot, Error> {
  const client = useQueryClient()
  const nextEligibleAt = useCallback(() => {
    const state = client.getQueryState<ResultSnapshot, Error>(queryKey)
    const error = state?.error
    // Anchor to the failed request, not to renders or visibility changes.
    return error
      ? (state?.errorUpdatedAt ?? 0) +
          Math.max(POLL_MS, error instanceof OfficialRequestError ? (error.retryAfterMs ?? 0) : 0)
      : 0
  }, [client, queryKey])
  const subscribe = useCallback(
    (onChange: () => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const update = () => {
        clearTimeout(timer)
        const remaining = nextEligibleAt() - Date.now()
        if (remaining > 0) {
          // Browsers clamp timeouts beyond a signed 32-bit integer.
          timer = setTimeout(update, Math.min(remaining, 2_147_483_647))
        }
        onChange()
      }
      const unsubscribe = client.getQueryCache().subscribe(update)
      document.addEventListener('visibilitychange', update)
      update()
      return () => {
        unsubscribe()
        document.removeEventListener('visibilitychange', update)
        clearTimeout(timer)
      }
    },
    [client, nextEligibleAt],
  )
  const available = useSyncExternalStore(
    subscribe,
    () => document.visibilityState !== 'hidden' && Date.now() >= nextEligibleAt(),
    () => false,
  )

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => load(signal),
    enabled: enabled && available,
    staleTime: POLL_MS,
    gcTime: 5 * 60_000,
    meta: { liveResult: true },
    retry: shouldRetry,
    retryDelay,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}
