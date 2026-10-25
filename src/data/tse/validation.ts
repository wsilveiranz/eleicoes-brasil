import { compactVerify, decodeProtectedHeader, importJWK } from 'jose'
import { z } from 'zod'
import { ResultDataError } from '../../domain/results'
import { TSE_PUBLIC_JWK } from './trust'

export class OfficialValidationError extends ResultDataError {
  constructor(message: string, options?: ErrorOptions) {
    super(message)
    this.name = 'OfficialValidationError'
    if (options?.cause !== undefined) this.cause = options.cause
  }
}

export class AwaitingPublicationError extends OfficialValidationError {
  constructor(message = 'O TSE ainda não publicou votos para esta eleição e localidade.') {
    super(message)
    this.name = 'AwaitingPublicationError'
  }
}

let publicKey: ReturnType<typeof importJWK> | undefined

export async function verifyOfficialJws(token: string): Promise<unknown> {
  try {
    const compact = token.trim()
    const header = decodeProtectedHeader(compact)
    if (
      header.alg !== TSE_PUBLIC_JWK.alg ||
      header.kid !== TSE_PUBLIC_JWK.kid ||
      header.typ !== 'JOSE' ||
      header.jwk !== undefined ||
      header.jku !== undefined ||
      header.x5u !== undefined ||
      header.b64 === false
    ) {
      throw new Error('Cabeçalho, algoritmo ou chave não autorizado.')
    }
    publicKey ??= importJWK({ ...TSE_PUBLIC_JWK, key_ops: [...TSE_PUBLIC_JWK.key_ops] }, 'EdDSA')
    const verified = await compactVerify(compact, await publicKey, { algorithms: ['EdDSA'] })
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(verified.payload)) as unknown
  } catch (cause) {
    throw new OfficialValidationError('Assinatura JWS oficial inválida ou chave não reconhecida.', { cause })
  }
}

export function parseSource<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new OfficialValidationError(
      `Formato da fonte oficial inválido: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}.`,
      { cause: result.error },
    )
  }
  return result.data
}

export function sourceDate(date: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date)
  if (!match) throw new OfficialValidationError('Data oficial inválida.')
  const [, day, month, year] = match
  const iso = `${year}-${month}-${day}`
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new OfficialValidationError('Data oficial inválida.')
  }
  return iso
}

export function sourceTimestamp(date: string, time: string): string {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) {
    throw new OfficialValidationError('Hora oficial inválida.')
  }
  return new Date(`${sourceDate(date)}T${time}-03:00`).toISOString()
}
