import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { generateKeyPair, SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import mapping from '../geography/countries.json'
import { aggregateResults, percentage } from '../../domain/results'
import {
  AwaitingPublicationError,
  discoverElection,
  loadDirectResult,
  loadMetadata,
  normalizeMetadata,
  normalizeResult,
  OfficialValidationError,
} from './client'
import { fetchOfficialText } from './http'
import { TSE_PUBLIC_JWK } from './trust'
import { sourceTimestamp, verifyOfficialJws } from './validation'

vi.mock('./http', () => ({ fetchOfficialText: vi.fn() }))

const fixtureText = (name: string, extension = 'json') =>
  readFileSync(resolve('tests', 'fixtures', `${name}.${extension}`), 'utf8')
const payload = (name: string): unknown => JSON.parse(fixtureText(name)) as unknown
const discovery = () => discoverElection(payload('elections'))
const metadata = () => normalizeMetadata(discovery(), payload('municipalities'))
const result = () => JSON.parse(fixtureText('overall')) as {
  ele: string; t: string; f: string; tpabr: string; cdabr: string; dv: string
  dg: string; hg: string; tf: string
  carg: Array<{
    cd: string
    agr: Array<{ par: Array<{ cand: Array<{
      sqcand: string; n: string; nm: string; nmu: string; vap: string; e: string; pvap: string
    }> }> }>
  }>
  s: { ts: string; st: string; snt: string }
  v: { tv: string; vv: string; vb: string; tvn: string; vvc: string; van: string; vn: string; vnt: string }
}

afterEach(() => vi.resetAllMocks())

describe('official pinned JWS verification', () => {
  it.each([
    'elections', 'municipalities', 'overall', 'overseas',
    'state-sp', 'municipality-sp71072', 'locality-zz29513',
    'comparison-elections', 'first-municipalities', 'second-municipalities',
    'first-overall', 'first-state-sp', 'second-overall', 'first-overseas', 'second-overseas',
    'first-zero-overseas', 'second-zero-overseas',
  ])('verifies the actual signed %s fixture and decodes UTF-8 exactly', async (name) => {
    expect(await verifyOfficialJws(fixtureText(name, 'jws'))).toEqual(payload(name))
  })

  it('preserves exact signed comparison source and payload hashes in fixture provenance', () => {
    const provenance = JSON.parse(fixtureText('comparison-sources')) as {
      captures: Array<{ name: string; sha256: string; payloadSha256: string; url: string }>
    }
    for (const capture of provenance.captures) {
      const token = fixtureText(capture.name, 'jws')
      const bytes = Buffer.from(token.trim().split('.')[1]!, 'base64url')
      expect(createHash('sha256').update(token).digest('hex')).toBe(capture.sha256)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(capture.payloadSha256)
      expect(bytes.toString('utf8')).toBe(fixtureText(capture.name))
      expect(capture.url.startsWith('https://resultados.tse.jus.br/oficial/')).toBe(true)
    }
  })

  it('rejects payload tampering and broken signatures', async () => {
    const parts = fixtureText('overall', 'jws').trim().split('.')
    parts[1] = Buffer.from(JSON.stringify({ ...result(), ele: '9999' })).toString('base64url')
    await expect(verifyOfficialJws(parts.join('.'))).rejects.toBeInstanceOf(OfficialValidationError)
    const original = fixtureText('overall', 'jws').trim().split('.')
    const signature = Buffer.from(original[2]!, 'base64url')
    signature[0] = signature[0]! ^ 1
    original[2] = signature.toString('base64url')
    await expect(verifyOfficialJws(original.join('.'))).rejects.toThrow('Assinatura')
  })

  it.each([
    { kid: 'unreviewed-key' },
    { alg: 'HS256' },
    { typ: 'JWT' },
    { jwk: TSE_PUBLIC_JWK },
    { jku: 'https://example.com/keys' },
    { b64: false },
  ])('rejects an untrusted protected header %j', async (change) => {
    const parts = fixtureText('overall', 'jws').trim().split('.')
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as object
    parts[0] = Buffer.from(JSON.stringify({ ...header, ...change })).toString('base64url')
    await expect(verifyOfficialJws(parts.join('.'))).rejects.toBeInstanceOf(OfficialValidationError)
  })

  it('rejects a valid Ed25519 signature by a different key even with the official kid', async () => {
    const key = await generateKeyPair('EdDSA')
    const forged = await new SignJWT({ election: '6258' }).setProtectedHeader({
      alg: 'EdDSA', typ: 'JOSE', kid: TSE_PUBLIC_JWK.kid,
    }).sign(key.privateKey)
    await expect(verifyOfficialJws(forged)).rejects.toThrow('Assinatura')
    await expect(verifyOfficialJws('not.a.token')).rejects.toThrow('Assinatura')
  })
})

describe('discovery and complete government-source country mapping', () => {
  it('discovers and verifies both official presidential rounds with explicit inventory coverage', async () => {
    const source = await verifyOfficialJws(fixtureText('comparison-elections', 'jws'))
    const firstElection = discoverElection(source, '1')
    const secondElection = discoverElection(source, '2')
    expect(firstElection).toMatchObject({ id: '6257', round: '1', date: '2026-10-04' })
    expect(secondElection).toMatchObject({ id: '6258', round: '2', date: '2026-10-25' })
    const first = normalizeMetadata(firstElection, await verifyOfficialJws(fixtureText('first-municipalities', 'jws')))
    const second = normalizeMetadata(secondElection, await verifyOfficialJws(fixtureText('second-municipalities', 'jws')))
    expect(first.states).toEqual(second.states)
    expect(first.countries).toEqual(second.countries)
    expect(first.overseasMunicipalities).toEqual(second.overseasMunicipalities)
    expect(first.states.flatMap((state) => state.municipalities)).toHaveLength(5571)
    expect(first.overseasMunicipalities).toHaveLength(186)
    expect(() => normalizeMetadata({ ...firstElection, id: '9999' }, payload('first-municipalities'))).toThrow('não cobre')
  })

  it('normalizes signed first-round counts and canonical finalists independent of candidate order', async () => {
    const election = discoverElection(payload('comparison-elections'), '1')
    const data = normalizeMetadata(election, payload('first-municipalities'))
    const source = await verifyOfficialJws(fixtureText('first-overall', 'jws'))
    const snapshot = normalizeResult(source, data, { state: 'br' })
    expect(snapshot.validVotes).toBe(119300788)
    expect(snapshot.candidates).toHaveLength(12)
    expect(snapshot.candidates.find((item) => item.number === '13')).toMatchObject({ id: '280002542548', party: 'PT' })
    expect(snapshot.candidates.find((item) => item.number === '22')).toMatchObject({ id: '280002551544', party: 'PL' })
    expect(snapshot.candidates.reduce((sum, item) => sum + item.votes, 0)).toBe(snapshot.validVotes)
    expect(snapshot.countingComplete).toBe(true)
    expect(() => normalizeResult(source, metadata(), { state: 'br' })).toThrow('turno')
  })

  it.each([
    ['1', 'first', '119300788'],
    ['2', 'second', '124082273'],
  ] as const)('verifies the final round %s national and overseas contracts, including official zero-vote locations', async (round, prefix, nationalVotes) => {
    const data = normalizeMetadata(
      discoverElection(payload('comparison-elections'), round),
      payload(`${prefix}-municipalities`),
    )
    const national = normalizeResult(await verifyOfficialJws(fixtureText(`${prefix}-overall`, 'jws')), data, { state: 'br' })
    const overseas = normalizeResult(await verifyOfficialJws(fixtureText(`${prefix}-overseas`, 'jws')), data, { state: 'zz' })
    expect(national.validVotes).toBe(Number(nationalVotes))
    expect(national.countingComplete).toBe(true)
    expect(overseas.countingComplete).toBe(true)
    const zero = normalizeResult(
      await verifyOfficialJws(fixtureText(`${prefix}-zero-overseas`, 'jws')),
      data, { state: 'zz', municipality: '29424' },
    )
    expect(zero).toMatchObject({
      validVotes: 0, totalVotes: 0, countingComplete: true, sections: { total: 1, counted: 1 },
    })
    expect(zero.candidates.every((candidate) => candidate.votes === 0)).toBe(true)
  })

  it('rejects unreviewed vote destinations, including zero-vote annulled candidates', () => {
    const source = JSON.parse(fixtureText('first-overall')) as {
      carg: Array<{ agr: Array<{ par: Array<{ cand: Array<{ dvt?: string }> }> }> }>
    }
    source.carg[0]!.agr[0]!.par[0]!.cand[0]!.dvt = 'Anulado'
    const data = normalizeMetadata(discoverElection(payload('comparison-elections'), '1'), payload('first-municipalities'))
    expect(() => normalizeResult(source, data, { state: 'br' })).toThrow('Destino de votos')
    delete source.carg[0]!.agr[0]!.par[0]!.cand[0]!.dvt
    expect(normalizeResult(source, data, { state: 'br' }).validVotes).toBe(119300788)
  })

  it('discovers the presidential runoff, preserves codes, and covers all 186 overseas localities once', () => {
    const data = metadata()
    expect(data.election).toMatchObject({ id: '6258', cycle: 'ele2026', round: '2', date: '2026-10-25' })
    expect(data.election.name).toContain('2º Turno')
    expect(data.states).toHaveLength(27)
    expect(data.states.find((state) => state.code === 'df')?.municipalities).toHaveLength(1)
    expect(data.states.find((state) => state.code === 'ac')?.municipalities[0]?.code).toBe('01120')
    expect(data.overseasMunicipalities).toHaveLength(186)
    const codes = data.countries.flatMap((country) => country.municipalities.map((city) => city.code))
    expect(new Set(codes).size).toBe(186)
    expect([...codes].sort()).toEqual(data.overseasMunicipalities.map((city) => city.code).sort())
    expect(data.countries.find((country) => country.name === 'Guiana Francesa')).toBeDefined()
  })

  it('does not hardcode the discovered election id', () => {
    const source = JSON.parse(fixtureText('elections')) as {
      pl: Array<{ e: Array<{ cd: string }> }>
    }
    for (const cycle of source.pl) {
      for (const election of cycle.e) if (election.cd === '6258') election.cd = '008888'
    }
    expect(discoverElection(source).id).toBe('008888')
  })

  it('rejects absent, ambiguous and malformed discovery', () => {
    expect(() => discoverElection({ f: 'o', pl: [] })).toThrow(AwaitingPublicationError)
    const source = JSON.parse(fixtureText('elections')) as { pl: unknown[] }
    source.pl.push(...structuredClone(source.pl))
    expect(() => discoverElection(source)).toThrow(AwaitingPublicationError)
    expect(() => discoverElection({ pl: null })).toThrow(OfficialValidationError)
  })

  it.each(['missing', 'duplicate', 'unknown', 'wrong-election'] as const)(
    'rejects %s country coverage',
    (problem) => {
      const changed = structuredClone(mapping)
      if (problem === 'missing') changed.countries[0]!.localityCodes.pop()
      if (problem === 'duplicate') changed.countries[0]!.localityCodes.push(changed.countries[0]!.localityCodes[0]!)
      if (problem === 'unknown') changed.countries[0]!.localityCodes[0] = '00000'
      if (problem === 'wrong-election') changed.election = '1234'
      expect(() => normalizeMetadata(discovery(), payload('municipalities'), changed)).toThrow(OfficialValidationError)
    },
  )

  it('rejects duplicate locality codes and incomplete domestic inventory', () => {
    const source = JSON.parse(fixtureText('municipalities')) as {
      abr: Array<{ cd: string; mu: unknown[] }>
    }
    source.abr[0]!.mu.push(source.abr[0]!.mu[0])
    expect(() => normalizeMetadata(discovery(), source)).toThrow('duplicados')
    source.abr.shift()
    expect(() => normalizeMetadata(discovery(), source)).toThrow('Inventário')
  })
})

describe('official count and geography normalization', () => {
  it.each([
    ['overall', { state: 'br' }, 'overall', 'overall'],
    ['overseas', { state: 'zz' }, 'overseas', 'overseas'],
    ['state-sp', { state: 'sp' }, 'state:sp', 'state'],
    ['municipality-sp71072', { state: 'sp', municipality: '71072' }, 'municipality:sp:71072', 'municipality'],
    ['locality-zz29513', { state: 'zz', municipality: '29513' }, 'municipality:zz:29513', 'municipality'],
  ] as const)('normalizes the signed-source %s contract', (name, location, id, kind) => {
    const snapshot = normalizeResult(payload(name), metadata(), location)
    expect(snapshot.geography).toMatchObject({ id, kind })
    expect(snapshot.geography.label.length).toBeGreaterThan(0)
    expect(snapshot.coverage).toEqual({ received: 1, expected: 1 })
    expect(Number.isFinite(Date.parse(snapshot.fetchedAt))).toBe(true)
    expect(snapshot.sourceTimes.oldest).toBe(snapshot.sourceTimes.latest)
  })

  it('uses st, not si/sa, and preserves the official vote fields and timestamp', () => {
    const snapshot = normalizeResult(payload('overseas'), metadata(), { state: 'zz' })
    expect(snapshot.sections).toEqual({ total: 1351, counted: 817 })
    expect(snapshot).toMatchObject({ totalVotes: 243602, validVotes: 236937, blankVotes: 3278, nullVotes: 3387 })
    expect(normalizeResult(payload('overall'), metadata(), { state: 'br' }).sourceTimes.oldest)
      .toBe('2026-10-25T22:22:17.000Z')
    expect(snapshot.candidates.every((candidate) => !candidate.elected)).toBe(true)
    expect(snapshot.countingComplete).toBe(false)
  })

  it('keeps genuine zero denominators as zero counts, not invented percentages', () => {
    const snapshot = normalizeResult(payload('municipality-sp71072'), metadata(), { state: 'sp', municipality: '71072' })
    expect(snapshot.validVotes).toBe(0)
    expect(percentage(snapshot.candidates[0]!.votes, snapshot.validVotes)).toBeNull()
  })

  it('keeps UTF-8 candidate names and only official s/S elected/final flags', () => {
    const changed = result()
    changed.carg[0]!.agr[0]!.par[0]!.cand[0]!.nmu = 'João Inácio'
    changed.carg[0]!.agr[0]!.par[0]!.cand[0]!.e = 'S'
    changed.tf = 'S'
    const snapshot = normalizeResult(changed, metadata(), { state: 'br' })
    expect(snapshot.candidates[0]).toMatchObject({ name: 'João Inácio', elected: true })
    expect(snapshot.countingComplete).toBe(true)
  })

  it.each([
    ['ele', '9999'], ['t', '1'], ['f', 's'], ['tpabr', 'uf'], ['cdabr', 'sp'],
  ])('rejects wrong %s', (field, value) => {
    const changed = { ...result(), [field]: value }
    expect(() => normalizeResult(changed, metadata(), { state: 'br' })).toThrow(OfficialValidationError)
  })

  it('rejects wrong or duplicated offices and unpublished vote data', () => {
    const changed = result()
    changed.carg[0]!.cd = '3'
    expect(() => normalizeResult(changed, metadata(), { state: 'br' })).toThrow('cargo')
    changed.carg[0]!.cd = '1'
    changed.carg.push(structuredClone(changed.carg[0]!))
    expect(() => normalizeResult(changed, metadata(), { state: 'br' })).toThrow('cargo')
    expect(() => normalizeResult({ ...result(), dv: 'n' }, metadata(), { state: 'br' })).toThrow(AwaitingPublicationError)
  })

  it.each([
    { state: 'xx' }, { state: 'SP' }, { state: 'sp', municipality: '01120' },
    { state: 'br', municipality: '71072' }, { state: 'zz', municipality: '71072' },
  ])('rejects nonmember locality %j before fetching', async (location) => {
    await expect(loadDirectResult(metadata(), location, new AbortController().signal)).rejects.toThrow(OfficialValidationError)
    expect(fetchOfficialText).not.toHaveBeenCalled()
  })

  it.each(['-1', '1.2', '1,2', '9007199254740992', ''])('rejects unsafe candidate count %s', (value) => {
    const changed = result()
    changed.carg[0]!.agr[0]!.par[0]!.cand[0]!.vap = value
    expect(() => normalizeResult(changed, metadata(), { state: 'br' })).toThrow(OfficialValidationError)
  })

  it('rejects missing counts, percentages, duplicate candidates and inconsistent totals', () => {
    const changed = result()
    const { vv: omitted, ...votes } = changed.v
    expect(omitted).toBeDefined()
    expect(() => normalizeResult({ ...changed, v: votes }, metadata(), { state: 'br' })).toThrow('v.vv')
    changed.carg[0]!.agr[0]!.par[0]!.cand[0]!.pvap = '101,0'
    expect(() => normalizeResult(changed, metadata(), { state: 'br' })).toThrow('pvap')
    changed.carg[0]!.agr[0]!.par[0]!.cand[0]!.pvap = '48,67'
    changed.carg[0]!.agr[0]!.par[0]!.cand.push(structuredClone(changed.carg[0]!.agr[0]!.par[0]!.cand[0]!))
    expect(() => normalizeResult(changed, metadata(), { state: 'br' })).toThrow('duplicados')
    const totals = result()
    totals.v.tv = '1'
    expect(() => normalizeResult(totals, metadata(), { state: 'br' })).toThrow('inconsistentes')
    totals.v.tv = '3751061'
    totals.s.st = '999999'
    expect(() => normalizeResult(totals, metadata(), { state: 'br' })).toThrow('inconsistentes')
  })

  it('does not incorrectly equate valid votes plus blank/null with all ballots when annulled votes exist', () => {
    const changed = result()
    changed.v.vv = String(Number(changed.v.vv) - 10)
    changed.v.van = '10'
    expect(() => normalizeResult(changed, metadata(), { state: 'br' })).toThrow('inconsistentes')
  })

  it('accepts the official uppercase publication flag', () => {
    expect(normalizeResult({ ...result(), dv: 'S' }, metadata(), { state: 'br' }).geography.id)
      .toBe('overall')
  })

  it('rejects candidate counts that cannot be displayed as shares of valid votes', () => {
    const changed = result()
    changed.v.vv = '1'
    expect(() => normalizeResult(changed, metadata(), { state: 'br' }))
      .toThrow('inconsistentes')
  })

  it('accepts separately tallied annulled votes without pretending they are candidate votes', () => {
    const changed = result()
    changed.v.vvc = String(Number(changed.v.vvc) + 10)
    changed.v.tv = String(Number(changed.v.tv) + 10)
    changed.v.van = '10'
    const snapshot = normalizeResult(changed, metadata(), { state: 'br' })
    expect(snapshot.candidates.reduce((sum, candidate) => sum + candidate.votes, 0)).toBe(snapshot.validVotes)
    expect(snapshot.totalVotes).toBe(snapshot.validVotes + snapshot.blankVotes + snapshot.nullVotes + 10)
  })

  it.each([
    ['31/02/2026', '12:00:00'], ['25/10/2026', '24:00:00'],
    ['25/10/2026', '12:00'], ['2026-10-25', '12:00:00'],
  ])('rejects invalid source date/time %s %s', (date, time) => {
    expect(() => sourceTimestamp(date, time)).toThrow(OfficialValidationError)
  })
})

describe('transport integration', () => {
  it('loads and requests the explicitly selected first-round signed sources', async () => {
    vi.mocked(fetchOfficialText).mockResolvedValueOnce(fixtureText('comparison-elections', 'jws'))
      .mockResolvedValueOnce(fixtureText('first-municipalities', 'jws'))
    const signal = new AbortController().signal
    const data = await loadMetadata(signal, '1')
    expect(data.election.id).toBe('6257')
    expect(fetchOfficialText).toHaveBeenNthCalledWith(2, '/oficial/ele2026/6257/config/mun-e006257-cm.jws', signal)
    vi.mocked(fetchOfficialText).mockResolvedValueOnce(fixtureText('first-overall', 'jws'))
    expect((await loadDirectResult(data, { state: 'br' }, signal)).validVotes).toBe(119300788)
    expect(fetchOfficialText).toHaveBeenLastCalledWith(
      '/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.jws', signal,
    )
  })

  it('loads only signed discovery and metadata files through the shared transport', async () => {
    vi.mocked(fetchOfficialText).mockResolvedValueOnce(fixtureText('elections', 'jws'))
      .mockResolvedValueOnce(fixtureText('municipalities', 'jws'))
    const signal = new AbortController().signal
    const data = await loadMetadata(signal)
    expect(data.election.id).toBe('6258')
    expect(fetchOfficialText).toHaveBeenNthCalledWith(1, '/oficial/comum/config/ele-c.jws', signal)
    expect(fetchOfficialText).toHaveBeenNthCalledWith(2, '/oficial/ele2026/6258/config/mun-e006258-cm.jws', signal)
  })

  describe('complete captured geography inventories', () => {
    it('verifies and normalizes every domestic state, including DF and excluding ZZ', async () => {
      const data = metadata()
      const snapshots = await Promise.all(data.states.map(async (state) => {
        const official = await verifyOfficialJws(fixtureText(`state-${state.code}`, 'jws'))
        return normalizeResult(official, data, { state: state.code })
      }))
      const aggregate = aggregateResults(
        { id: 'domestic', kind: 'domestic', label: 'Brasil' },
        data.states.map((state) => `state:${state.code}`),
        snapshots,
      )
      expect(aggregate.coverage).toEqual({ received: 27, expected: 27 })
      expect(aggregate.totalVotes).toBe(snapshots.reduce((sum, item) => sum + item.totalVotes, 0))
    })

    it('verifies every captured Portugal locality and aggregates the full official country inventory', async () => {
      const data = metadata()
      const portugal = data.countries.find((country) => country.name === 'Portugal')!
      expect(portugal.municipalities).toHaveLength(3)
      const snapshots = await Promise.all(portugal.municipalities.map(async (city) => {
        const official = await verifyOfficialJws(fixtureText(`locality-zz${city.code}`, 'jws'))
        return normalizeResult(official, data, { state: 'zz', municipality: city.code })
      }))
      const aggregate = aggregateResults(
        { id: `country:${portugal.code}`, kind: 'country', label: portugal.name },
        portugal.municipalities.map((city) => `municipality:zz:${city.code}`),
        snapshots,
      )
      expect(aggregate.coverage).toEqual({ received: 3, expected: 3 })
      expect(aggregate.sections.counted).toBe(snapshots.reduce((sum, item) => sum + item.sections.counted, 0))
    })
  })

  it('requests only the selected geography with the dynamically discovered id', async () => {
    vi.mocked(fetchOfficialText).mockResolvedValue(fixtureText('municipality-sp71072', 'jws'))
    const signal = new AbortController().signal
    const snapshot = await loadDirectResult(metadata(), { state: 'sp', municipality: '71072' }, signal)
    expect(snapshot.geography.id).toBe('municipality:sp:71072')
    expect(fetchOfficialText).toHaveBeenCalledExactlyOnceWith(
      '/oficial/ele2026/6258/dados/sp/sp71072-c0001-e006258-u.jws', signal,
    )
  })

  it('does not swallow HTTP failures, cancellations or signature errors', async () => {
    const error = new Error('upstream unavailable')
    vi.mocked(fetchOfficialText).mockRejectedValueOnce(error)
    await expect(loadMetadata(new AbortController().signal)).rejects.toBe(error)
    vi.mocked(fetchOfficialText).mockResolvedValueOnce('bad.token.signature')
    await expect(loadMetadata(new AbortController().signal)).rejects.toThrow(OfficialValidationError)
    const controller = new AbortController()
    controller.abort()
    vi.mocked(fetchOfficialText).mockResolvedValueOnce(fixtureText('elections', 'jws'))
    await expect(loadMetadata(controller.signal)).rejects.toBe(controller.signal.reason)
  })
})
