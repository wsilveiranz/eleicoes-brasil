import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClientProvider, focusManager, type QueryClient } from '@tanstack/react-query'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppQueryClient } from '../app/queryClient'
import { OfficialRequestError } from '../data/tse/http'
import { ResultDataError, type ResultSnapshot } from '../domain/results'
import { useLiveResult } from './useLiveResult'

function snapshot(id = 'br'): ResultSnapshot {
  return {
    electionId: '2026',
    geography: { id, kind: 'overall', label: id },
    candidates: [],
    validVotes: 0,
    totalVotes: 0,
    blankVotes: 0,
    nullVotes: 0,
    sections: { total: 1, counted: 0 },
    countingComplete: false,
    sourceTimes: { oldest: '2026-10-25T12:00:00Z', latest: '2026-10-25T12:00:00Z' },
    fetchedAt: '2026-10-25T12:00:00Z',
    coverage: { received: 1, expected: 1 },
  }
}

let client: QueryClient
let visibility: DocumentVisibilityState

function wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function setVisibility(value: DocumentVisibilityState) {
  await act(async () => {
    visibility = value
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
  })
  await advance()
}

beforeEach(() => {
  vi.useFakeTimers()
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  focusManager.setFocused(undefined)
  client = createAppQueryClient()
})

afterEach(() => {
  cleanup()
  client.clear()
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

describe('useLiveResult', () => {
  it('polls every 30 seconds and pauses while hidden, resuming stale data on visibility', async () => {
    const load = vi.fn().mockResolvedValue(snapshot())
    const { result } = renderHook(() => useLiveResult(['live', 'br'], load), { wrapper })
    await advance()
    expect(result.current.data?.geography.id).toBe('br')
    expect(load).toHaveBeenCalledTimes(1)
    await advance(29_999)
    expect(load).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(load).toHaveBeenCalledTimes(2)
    await setVisibility('hidden')
    await advance(90_000)
    expect(load).toHaveBeenCalledTimes(2)
    await setVisibility('visible')
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not load initially hidden or disabled and does not refetch fresh data on visibility', async () => {
    visibility = 'hidden'
    const load = vi.fn().mockResolvedValue(snapshot())
    const { rerender } = renderHook(
      ({ enabled }) => useLiveResult(['live', 'br'], load, enabled),
      { wrapper, initialProps: { enabled: false } },
    )
    await setVisibility('visible')
    await advance(60_000)
    expect(load).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await advance()
    expect(load).toHaveBeenCalledTimes(1)
    await setVisibility('hidden')
    await advance(1_000)
    await setVisibility('visible')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('deduplicates observers and never overlaps slow polling cycles', async () => {
    let resolve!: (value: ResultSnapshot) => void
    const load = vi.fn(() => new Promise<ResultSnapshot>((done) => { resolve = done }))
    renderHook(() => {
      useLiveResult(['live', 'br'], load)
      return useLiveResult(['live', 'br'], load)
    }, { wrapper })
    await advance(120_000)
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => resolve(snapshot()))
    await advance(30_000)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps last good same-key data after schema errors without rapid retries', async () => {
    const good = snapshot()
    const load = vi.fn().mockResolvedValueOnce(good).mockRejectedValue(new ResultDataError('schema'))
    const { result } = renderHook(() => useLiveResult(['live', 'br'], load), { wrapper })
    expect(result.current.isRefetchError).toBe(false)
    await advance()
    await advance(30_000)
    await advance()
    expect(result.current.data).toEqual(good)
    expect(result.current.isRefetchError).toBe(true)
    await advance(29_999)
    expect(load).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('never presents a previous geography and aborts on key switches and unmount', async () => {
    const signals: AbortSignal[] = []
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<ResultSnapshot>(() => {})
    })
    client.setQueryData(['live', 'br'], snapshot())
    const { result, rerender, unmount } = renderHook(
      ({ id }) => useLiveResult(['live', id], load),
      { wrapper, initialProps: { id: 'br' } },
    )
    expect(result.current.data?.geography.id).toBe('br')
    rerender({ id: 'sp' })
    expect(result.current.data).toBeUndefined()
    expect(signals).toHaveLength(1)
    rerender({ id: 'rj' })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
    unmount()
    expect(signals[1]?.aborted).toBe(true)
  })

  it('uses bounded transport retries, then respects the absolute Retry-After deadline', async () => {
    const error = new OfficialRequestError('busy', { status: 429, retryAfterMs: 90_000 })
    const load = vi.fn().mockRejectedValue(error)
    const { rerender, result } = renderHook(() => useLiveResult(['live', 'br'], load), { wrapper })
    await advance()
    await advance(89_999)
    expect(load).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(load).toHaveBeenCalledTimes(2)
    await advance(90_000)
    await advance()
    expect(load).toHaveBeenCalledTimes(3)
    expect(result.current.isError).toBe(true)
    await advance(40_000)
    rerender()
    await setVisibility('hidden')
    focusManager.setFocused(true)
    await advance(10_000)
    await setVisibility('visible')
    expect(load).toHaveBeenCalledTimes(3)
    await advance(39_999)
    expect(load).toHaveBeenCalledTimes(3)
    await advance(1)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('does not retry signature failures or refetch while hidden even on focus', async () => {
    const load = vi.fn().mockRejectedValue(new Error('invalid signature'))
    renderHook(() => useLiveResult(['live', 'br'], load), { wrapper })
    await advance()
    await advance(29_999)
    expect(load).toHaveBeenCalledTimes(1)
    await setVisibility('hidden')
    act(() => focusManager.setFocused(true))
    await advance(90_000)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('does not let visibility toggles create schema-error retry storms', async () => {
    const load = vi.fn().mockRejectedValue(new ResultDataError('schema'))
    renderHook(() => useLiveResult(['live', 'br'], load), { wrapper })
    await advance()
    await setVisibility('hidden')
    await advance(1_000)
    await setVisibility('visible')
    await advance(28_999)
    expect(load).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('pauses scheduled transport retries while hidden', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new OfficialRequestError('offline'))
      .mockResolvedValue(snapshot())
    renderHook(() => useLiveResult(['live', 'br'], load), { wrapper })
    await advance()
    await setVisibility('hidden')
    await advance(10_000)
    expect(load).toHaveBeenCalledTimes(1)
    await setVisibility('visible')
    await advance()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
