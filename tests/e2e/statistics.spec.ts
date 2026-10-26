import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DatasetManifest, DatasetSummary } from '../../src/domain/comparison'
import { blankNullComparisons, groupAgeBands, regionalVotes } from '../../src/domain/statistics'
import type { AgeData, ParticipationData } from '../../src/data/statistics'

const root = path.join(process.cwd(), 'public', 'data', '2026')
const integer = new Intl.NumberFormat('pt-BR')
let summary: DatasetSummary
let participation: ParticipationData
let ages: AgeData
test.beforeAll(async () => {
  const manifest: DatasetManifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
  summary = JSON.parse(await readFile(path.join(root, manifest.summary.path), 'utf8'))
  participation = JSON.parse(await readFile(path.join(root, 'participation.json'), 'utf8'))
  ages = JSON.parse(await readFile(path.join(root, 'age-turnout.json'), 'utf8'))
})

test('statistics is shareable, accessible, lazy-loaded and preserves result navigation', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?visao=brasil&uf=sp')
  await expect(page.locator('.results-panel')).toBeVisible()
  expect(requests.some((url) => url.endsWith('/participation.json') || url.endsWith('/age-turnout.json'))).toBe(false)
  const navigation = page.getByRole('navigation', { name: 'Áreas do painel' })
  await navigation.getByRole('button', { name: 'Participação e perfil eleitoral', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/visao=brasil&uf=sp&area=estatisticas/)
  const statistics = page.getByRole('region', { name: 'Participação e perfil eleitoral', exact: true })
  await expect(statistics).toBeVisible()
  await expect(page.locator('.geography-scopes')).toHaveCount(0)
  await expect(page.locator('.state-map-card')).toHaveCount(0)
  await expect(page.locator('.statistics-turnout-track')).toHaveCount(12)
  const national = statistics.getByRole('region', { name: 'Participação total nos dois turnos' })
  await expect(national).toContainText(integer.format(participation.first.overall.eligible))
  await expect(national).toContainText(integer.format(participation.first.overall.attended))
  await expect(national).toContainText(integer.format(participation.second.overall.attended))
  const regionalTable = page.getByRole('table', { name: 'Origem regional dos votos · comparação dos turnos' })
  await expect(regionalTable).toHaveCount(1)
  await expect(regionalTable).toContainText(integer.format(regionalVotes(summary, 'second', summary.finalists[0]!.id)[0]!.value))
  await expect(statistics.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Distribuição regional dos votos por candidato' }).getByRole('img')).toHaveCount(4)
  await expect(regionalTable).toContainText(
    integer.format(regionalVotes(summary, 'first', summary.finalists[0]!.id)[0]!.value),
  )
  const ageSection = page.getByRole('region', { name: 'Comparecimento por faixa etária' })
  await expect(ageSection).toBeVisible()
  await expect(ageSection.getByRole('table')).toHaveCount(1)
  await expect(ageSection.getByRole('row')).toHaveCount(11)
  await expect(ageSection.getByRole('row', { name: /16 a 17 anos/ })).toContainText('1.426.988')
  await expect(ageSection.getByRole('row', { name: /Idade desconhecida\/inválida/ })).toContainText('681')
  if (ages.second.status !== 'available') {
    await expect(ageSection).toContainText(/2º turno:.*ainda não publicados|2º turno:.*incompleta/)
  }
  await expect(ageSection).toContainText(/O voto é secreto/)
  const source = page.locator('.statistics-sources details')
  await expect(source).not.toHaveAttribute('open', '')
  expect(await page.locator('.statistics-sources').evaluate((element) => element.nextElementSibling === null)).toBe(true)
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const tracks = await page.locator('.statistics-turnout-track').evaluateAll((elements) => elements.map((element) => {
      const width = element.getBoundingClientRect().width
      const filled = [...element.children].reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
      return Math.abs(filled - width)
    }))
    expect(tracks.every((difference) => difference < 1)).toBe(true)
    const compositions = await page.locator('.statistics-composition-track').evaluateAll((elements) => elements.map((element) => ({
      left: element.getBoundingClientRect().left,
      width: element.getBoundingClientRect().width,
      segments: [...element.children].map((segment) => ({
        id: segment.getAttribute('data-composition'), width: segment.getBoundingClientRect().width,
      })),
    })))
    const expected = [
      ...summary.finalists.flatMap(({ id }) => [
        regionalVotes(summary, 'first', id), regionalVotes(summary, 'second', id),
      ]),
      ...[ages.first, ages.second].filter(({ status }) => status === 'available').map(({ bands }) =>
        groupAgeBands(bands).map((band) => ({ id: band.code, value: band.attended }))),
    ].filter((segments) => segments.some(({ value }) => value > 0))
    expect(compositions).toHaveLength(expected.length)
    for (const [index, composition] of compositions.entries()) {
      expect(Math.abs(composition.left - compositions[0]!.left)).toBeLessThan(1)
      expect(Math.abs(composition.width - compositions[0]!.width)).toBeLessThan(1)
      const total = expected[index]!.reduce((sum, segment) => sum + segment.value, 0)
      for (const segment of composition.segments) {
        const value = expected[index]!.find(({ id }) => id === segment.id)!.value
        expect(Math.abs(segment.width - composition.width * value / total)).toBeLessThan(1)
      }
      expect(Math.abs(composition.segments.reduce((sum, segment) => sum + segment.width, 0) - composition.width)).toBeLessThan(1)
    }
  }
  await page.reload()
  await expect(ageSection).toBeVisible()
  await navigation.getByRole('button', { name: 'Resultados', exact: true }).click()
  await expect(page).toHaveURL(/\?visao=brasil&uf=sp$/)
  await expect(page.locator('.app-geography-heading h2')).toHaveText('SÃO PAULO')
  await page.goBack()
  await expect(statistics).toBeVisible()
  expect(requests.some((url) => url.includes('cdn.tse.jus.br') || url.endsWith('.zip'))).toBe(false)
  expect(errors).toEqual([])
})

test('new complete second-round age data enables comparison without a frontend change', async ({ page }) => {
  const updated = structuredClone(ages)
  updated.checkedAt = new Date().toISOString()
  updated.lastSuccessAt = updated.checkedAt
  updated.dataUpdatedAt = updated.checkedAt
  updated.refresh = 'ok'
  updated.error = null
  updated.second = { ...structuredClone(updated.first), sourceGeneratedAt: '2026-10-26T12:00:00Z' }
  updated.first.bands = [{ code: '1600', label: '16 anos', eligible: 100, attended: 80, abstained: 20 }]
  updated.second.bands = [{ code: '1600', label: '16 anos', eligible: 100, attended: 90, abstained: 10 }]
  await page.route('**/data/2026/age-turnout.json', (route) => route.fulfill({ json: updated }))
  await page.goto('/?area=estatisticas')
  const section = page.getByRole('region', { name: 'Comparecimento por faixa etária' })
  await expect(section.getByRole('img')).toHaveCount(2)
  await expect(section.locator('.statistics-composition-track > span')).toHaveCount(2)
  const segments = await section.locator('.statistics-composition-track > span').evaluateAll((elements) => elements.map((element) => ({
    id: element.getAttribute('data-composition'), color: getComputedStyle(element).backgroundColor,
    fillsTrack: Math.abs(element.getBoundingClientRect().width - element.parentElement!.getBoundingClientRect().width) < 1,
  })))
  expect(segments[0]).toEqual(segments[1])
  expect(segments[0]!.fillsTrack).toBe(true)
  const row = section.getByRole('row', { name: /16 a 17 anos/ })
  await expect(row).toContainText('90,00%')
  await expect(row).toContainText('+10,00 pp')
  await expect(section).not.toContainText('ainda não publicados')
})

test('blank/null stacks compare actual counts on shared national/regional scales with correct ballot denominators', async ({ page }) => {
  await page.goto('/?area=estatisticas')
  const section = page.getByRole('region', { name: 'Votos brancos e nulos nos dois turnos' })
  await expect(section.getByRole('img')).toHaveCount(12)
  const nationalRows = section.getByRole('rowgroup', { name: 'Total geral · Brasil e exterior' })
  await expect(nationalRows.getByRole('row', { name: /Brancos \+ nulos/ })).toContainText('−1.821.246')
  await expect(nationalRows.getByRole('row', { name: /Brancos \+ nulos/ })).toContainText('−1,53 pp')
  const comparisons = blankNullComparisons(summary)
  const regionalMaximum = Math.max(...comparisons.slice(1).flatMap(({ first, second }) =>
    [first.blankVotes + first.nullVotes, second.blankVotes + second.nullVotes]))
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 })
    const boxes = await section.locator('.statistics-invalid-track').evaluateAll((tracks) => tracks.map((track) => ({
      width: track.getBoundingClientRect().width,
      segments: [...track.children].map((segment) => segment.getBoundingClientRect().width),
    })))
    for (const [index, comparison] of comparisons.entries()) {
      const maximum = index === 0 ? Math.max(
        comparison.first.blankVotes + comparison.first.nullVotes,
        comparison.second.blankVotes + comparison.second.nullVotes,
      ) : regionalMaximum
      for (const [turnIndex, turn] of (['first', 'second'] as const).entries()) {
        const box = boxes[index * 2 + turnIndex]!
        for (const [segmentIndex, key] of (['blankVotes', 'nullVotes'] as const).entries()) {
          expect(Math.abs(box.segments[segmentIndex]! - box.width * comparison[turn][key] / maximum)).toBeLessThan(1)
        }
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await expect(section).toContainText('Não prova que essas mesmas pessoas')
})

test('refresh failures and malformed age data are explicit rather than invented statistics', async ({ page }) => {
  const stale: AgeData = {
    ...ages, refresh: 'error', error: 'Falha ao verificar a fonte TSE: HTTP 503',
    lastSuccessAt: '2026-01-01T00:00:00Z',
  }
  await page.route('**/data/2026/age-turnout.json', (route) => route.fulfill({ json: stale }))
  await page.goto('/?area=estatisticas')
  const section = page.getByRole('region', { name: 'Comparecimento por faixa etária' })
  await expect(section).toContainText('HTTP 503')
  await expect(section).toContainText('Verificação atrasada')
  await expect(section.getByRole('table')).toBeVisible()
  await page.unroute('**/data/2026/age-turnout.json')
  await page.route('**/data/2026/age-turnout.json', (route) => route.fulfill({ json: { ...ages, year: 2022 } }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText(/perfil etário inválidos/)
  await expect(page.getByRole('region', { name: 'Comparecimento por faixa etária' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Participação total nos dois turnos' })).toBeVisible()
})
