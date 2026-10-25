import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchOfficialText,
  OfficialRequestError,
  parseRetryAfter,
  RequestQueue,
  retryDelay,
  shouldRetry,
} from './http'

afterEach(() => vi.unstubAllGlobals())

describe('RequestQueue', () => {
  it('limits concurrent work and releases slots when requests finish', async () => {
    const queue = new RequestQueue(4)
    let active = 0
    let maximum = 0
    const releases: Array<() => void> = []
    const jobs = Array.from({ length: 8 }, () =>
      queue.run(new AbortController().signal, async () => {
        active += 1
        maximum = Math.max(maximum, active)
        await new Promise<void>((resolve) => releases.push(resolve))
        active -= 1
      }),
    )
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(releases).toHaveLength(4))
    releases.splice(0).forEach((release) => release())
    await Promise.all(jobs)
    expect(maximum).toBe(4)
  })

  it('cancels queued work without starting it or losing a slot', async () => {
    const queue = new RequestQueue(1)
    let finish: (() => void) | undefined
    const first = queue.run(new AbortController().signal, () =>
      new Promise<void>((resolve) => { finish = resolve }),
    )
    await vi.waitFor(() => expect(finish).toBeDefined())
    const controller = new AbortController()
    const work = vi.fn()
    const second = queue.run(controller.signal, work)
    const rejected = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    finish?.()
    await first
    await queue.run(new AbortController().signal, async () => undefined)
    expect(work).not.toHaveBeenCalled()
  })

  it('releases slots after failure', async () => {
    const queue = new RequestQueue(1)
    await expect(queue.run(new AbortController().signal, async () => {
      throw new Error('failure')
    })).rejects.toThrow('failure')
    await expect(queue.run(new AbortController().signal, async () => 42)).resolves.toBe(42)
  })
})

describe('official HTTP transport', () => {
  it('fetches official resources without credentials or custom request headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('signed-result'))
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchOfficialText('/oficial/comum/config/ele-c.jws', new AbortController().signal))
      .resolves.toBe('signed-result')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' })
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty('headers')
  })

  it('rejects non-official origins before making a request', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(fetchOfficialText('https://example.com/oficial/data', new AbortController().signal))
      .rejects.toThrow(/inválido/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('surfaces HTTP errors and official retry guidance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {
      status: 429,
      headers: { 'Retry-After': '120' },
    })))
    await expect(fetchOfficialText('/oficial/data', new AbortController().signal))
      .rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 })
  })

  it('does not disguise a network failure as successful empty data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    await expect(fetchOfficialText('/oficial/data', new AbortController().signal))
      .rejects.toThrow(/Não foi possível/)
  })
})

describe('retry policy', () => {
  it('parses delta seconds and dates, ignoring invalid headers', () => {
    expect(parseRetryAfter('30')).toBe(30_000)
    expect(parseRetryAfter('Sun, 25 Oct 2026 22:00:30 GMT', Date.parse('2026-10-25T22:00:00Z')))
      .toBe(30_000)
    expect(parseRetryAfter('invalid')).toBeNull()
    expect(parseRetryAfter(null)).toBeNull()
  })

  it('retries transient HTTP/network errors only, at most twice', () => {
    expect(shouldRetry(0, new OfficialRequestError('error', { status: 429 }))).toBe(true)
    expect(shouldRetry(2, new OfficialRequestError('error', { status: 503 }))).toBe(false)
    expect(shouldRetry(0, new OfficialRequestError('error', { status: 404 }))).toBe(false)
    expect(shouldRetry(0, new Error('invalid signature'))).toBe(false)
    expect(retryDelay(0, new OfficialRequestError('error', { retryAfterMs: 120_000 })))
      .toBe(120_000)
  })
})
