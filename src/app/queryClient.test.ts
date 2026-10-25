import { QueryObserver } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppQueryClient } from './queryClient'

afterEach(() => vi.useRealTimers())

it('collects inactive results after five minutes while preserving active queries', async () => {
  vi.useFakeTimers()
  const client = createAppQueryClient()
  const observer = new QueryObserver(client, { queryKey: ['active'], enabled: false })
  const unsubscribe = observer.subscribe(() => {})
  client.setQueryData(['inactive'], 1)
  await vi.advanceTimersByTimeAsync(5 * 60_000)
  expect(client.getQueryState(['inactive'])).toBeUndefined()
  expect(client.getQueryState(['active'])).toBeDefined()
  unsubscribe()
  client.clear()
})

it('caps retained live keys at 100 without removing observed queries or metadata', () => {
  const client = createAppQueryClient()
  const observer = new QueryObserver(client, {
    queryKey: ['active'],
    enabled: false,
    meta: { liveResult: true },
  })
  const unsubscribe = observer.subscribe(() => {})
  client.setQueryData(['metadata'], { name: 'election' })
  for (let i = 0; i < 150; i++) {
    const key = ['live', String(i)]
    client.setQueryDefaults(key, { meta: { liveResult: true } })
    client.setQueryData(key, i)
  }
  expect(client.getQueryCache().findAll({ predicate: (q) => q.meta?.liveResult === true }))
    .toHaveLength(100)
  expect(client.getQueryState(['active'])).toBeDefined()
  expect(client.getQueryData(['metadata'])).toEqual({ name: 'election' })
  unsubscribe()
  client.clear()
})
