export const TSE_ORIGIN = 'https://resultados.tse.jus.br'

export class OfficialRequestError extends Error {
  readonly status: number | null
  readonly retryAfterMs: number | null

  constructor(
    message: string,
    options: { status?: number; retryAfterMs?: number | null; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'OfficialRequestError'
    this.status = options.status ?? null
    this.retryAfterMs = options.retryAfterMs ?? null
  }
}

interface WaitingRequest {
  signal: AbortSignal
  resolve: () => void
  reject: (error: unknown) => void
  abort: () => void
}

export class RequestQueue {
  private active = 0
  private waiting: WaitingRequest[] = []

  constructor(private readonly limit = 4) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('O limite de requisições deve ser um inteiro positivo.')
    }
  }

  private async acquire(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.active < this.limit) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve, reject) => {
      const entry: WaitingRequest = {
        signal,
        resolve,
        reject,
        abort: () => {
          this.waiting = this.waiting.filter((item) => item !== entry)
          reject(signal.reason)
        },
      }
      this.waiting.push(entry)
      signal.addEventListener('abort', entry.abort, { once: true })
    })
  }

  private release() {
    this.active -= 1
    const next = this.waiting.shift()
    if (next) {
      next.signal.removeEventListener('abort', next.abort)
      this.active += 1
      next.resolve()
    }
  }

  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    await this.acquire(signal)
    try {
      signal.throwIfAborted()
      return await work()
    } finally {
      this.release()
    }
  }
}

const queue = new RequestQueue(4)

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null || value.trim() === '') return null
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) ? delay : null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null
}

export async function fetchOfficialText(path: string, signal: AbortSignal): Promise<string> {
  const url = new URL(path, TSE_ORIGIN)
  if (
    url.origin !== TSE_ORIGIN ||
    !url.pathname.startsWith('/oficial/') ||
    url.username ||
    url.password
  ) {
    throw new OfficialRequestError('Endereço da fonte oficial inválido.')
  }
  return queue.run(signal, async () => {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        credentials: 'omit',
      })
      if (!response.ok) {
        throw new OfficialRequestError(
          response.status === 404
            ? 'O TSE ainda não disponibilizou este arquivo de resultados (HTTP 404).'
            : `A fonte oficial respondeu com erro HTTP ${response.status}.`,
          {
            status: response.status,
            retryAfterMs: parseRetryAfter(response.headers.get('Retry-After')),
          },
        )
      }
      return await response.text()
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error instanceof OfficialRequestError) throw error
      throw new OfficialRequestError(
        'Não foi possível consultar o TSE. Verifique a conexão ou a disponibilidade da fonte oficial.',
        { cause: error },
      )
    }
  })
}

export function shouldRetry(failureCount: number, error: Error): boolean {
  if (!(error instanceof OfficialRequestError) || failureCount >= 2) return false
  return error.status === null || error.status === 408 || error.status === 429 || error.status >= 500
}

export function retryDelay(attempt: number, error: Error): number {
  if (error instanceof OfficialRequestError && error.retryAfterMs !== null) {
    return error.retryAfterMs
  }
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500)
}
