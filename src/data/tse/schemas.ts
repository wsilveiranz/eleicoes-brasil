import { z } from 'zod'

const text = z.string().trim().min(1)
const code = z.string().regex(/^\d+$/)
const localityCode = z.string().regex(/^\d{5}$/)
const stateCode = z.string().regex(/^[a-z]{2}$/)
const flag = z.enum(['s', 'S', 'n', 'N'])
export const sourceCount = z.string().regex(/^\d+$/).transform(Number)
  .refine(Number.isSafeInteger, 'Contagem fora do intervalo inteiro seguro.')
const sourcePercentage = z.string().regex(/^\d+(?:,\d+)?$/)
  .transform((value) => Number(value.replace(',', '.')))
  .refine((value) => Number.isFinite(value) && value >= 0 && value <= 100)

export const discoverySchema = z.object({
  f: z.literal('o'),
  pl: z.array(z.object({
    c: z.string().regex(/^ele\d{4}$/),
    dt: text,
    e: z.array(z.object({
      cd: code,
      nm: text,
      t: z.string(),
      abr: z.array(z.object({
        cd: stateCode,
        cp: z.array(z.object({ cd: code })),
      })),
    })),
  })),
})

export const municipalitySchema = z.object({
  f: z.literal('o'),
  abr: z.array(z.object({
    cd: stateCode,
    ds: text,
    mu: z.array(z.object({ cd: localityCode, nm: text })).min(1),
  })).min(1),
})

export const countryMappingSchema = z.object({
  schemaVersion: z.literal(1),
  election: code,
  cycle: z.string().regex(/^ele\d{4}$/),
  coverage: z.object({
    expected: z.number().int().positive(),
    mapped: z.number().int().positive(),
    unique: z.number().int().positive(),
  }),
  countries: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/),
    name: text,
    localityCodes: z.array(localityCode).min(1),
  })).min(1),
})

export const resultEnvelopeSchema = z.object({
  ele: code,
  t: z.string(),
  f: z.string(),
  tpabr: text,
  cdabr: text,
  dv: flag,
  carg: z.array(z.object({ cd: code }).passthrough()),
}).passthrough()

export const resultSchema = z.object({
  ele: code,
  t: z.enum(['1', '2']),
  f: z.literal('o'),
  tpabr: z.enum(['br', 'uf', 'mu']),
  cdabr: text,
  dg: text,
  hg: text,
  dv: flag,
  tf: flag,
  carg: z.array(z.object({
    cd: code,
    agr: z.array(z.object({
      par: z.array(z.object({
        sg: text,
        cand: z.array(z.object({
          sqcand: code,
          n: code,
          nm: text,
          nmu: text,
          vap: sourceCount,
          pvap: sourcePercentage,
          pvapn: sourcePercentage.optional(),
          e: flag,
          dvt: text.optional(),
          st: z.string(),
        })),
      })),
    })),
  })).min(1),
  s: z.object({
    ts: sourceCount,
    st: sourceCount,
    snt: sourceCount.optional(),
  }),
  v: z.object({
    tv: sourceCount,
    vv: sourceCount,
    vb: sourceCount,
    tvn: sourceCount,
    vvc: sourceCount,
    van: sourceCount.optional(),
    vansj: sourceCount.optional(),
    vn: sourceCount.optional(),
    vnt: sourceCount.optional(),
  }),
})

export type OfficialResult = z.infer<typeof resultSchema>
