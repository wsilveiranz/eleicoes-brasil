import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DatasetManifest, DatasetSummary } from '../../src/domain/comparison'
import { regionalVotes } from '../../src/domain/statistics'
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
  const regionalTable = page.getByRole('table', { name: 'Origem regional dos votos · 2º turno' })
  await expect(regionalTable).toHaveCount(1)
  await expect(regionalTable).toContainText(integer.format(regionalVotes(summary, 'second', summary.finalists[0]!.id)[0]!.value))
  await page.getByLabel('Turno da distribuição regional').selectOption('first')
  await expect(page.getByRole('table', { name: 'Origem regional dos votos · 1º turno' })).toContainText(
    integer.format(regionalVotes(summary, 'first', summary.finalists[0]!.id)[0]!.value),
  )
  const ageSection = page.getByRole('region', { name: 'Comparecimento por faixa etária' })
  await expect(ageSection).toBeVisible()
  await expect(ageSection.getByRole('table')).toHaveCount(1)
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
  updated.first.bands = [{ code: '1617', label: '16 a 17 anos', eligible: 100, attended: 80, abstained: 20 }]
  updated.second.bands = [{ code: '1617', label: '16 a 17 anos', eligible: 100, attended: 90, abstained: 10 }]
  await page.route('**/data/2026/age-turnout.json', (route) => route.fulfill({ json: updated }))
  await page.goto('/?area=estatisticas')
  const section = page.getByRole('region', { name: 'Comparecimento por faixa etária' })
  await expect(section.getByRole('img')).toHaveCount(2)
  const row = section.getByRole('row', { name: /16 a 17 anos/ })
  await expect(row).toContainText('90,00%')
  await expect(row).toContainText('+10,00 pp')
  await expect(section).not.toContainText('ainda não publicados')
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
