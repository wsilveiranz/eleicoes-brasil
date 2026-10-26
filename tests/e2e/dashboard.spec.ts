import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  DatasetManifest,
  DatasetSummary,
  MunicipalityShard,
  RoundComparison,
} from '../../src/domain/comparison'

const dataRoot = path.join(process.cwd(), 'public', 'data', '2026')
const format = new Intl.NumberFormat('pt-BR')
let manifest: DatasetManifest
let summary: DatasetSummary
let sp: MunicipalityShard

test.beforeAll(async () => {
  manifest = JSON.parse(await readFile(path.join(dataRoot, 'manifest.json'), 'utf8'))
  summary = JSON.parse(await readFile(path.join(dataRoot, manifest.summary.path), 'utf8'))
  const resource = manifest.municipalities.sp
  if (!resource) throw new Error('São Paulo municipality shard missing from dataset')
  sp = JSON.parse(await readFile(path.join(dataRoot, resource.path), 'utf8'))
})

function comparison(id: string): RoundComparison {
  const result = [...summary.comparisons, ...sp.comparisons].find((item) => item.geography.id === id)
  if (!result) throw new Error(`Missing comparison ${id}`)
  return result
}

async function expectTotals(page: Page, result: RoundComparison) {
  const panel = page.locator('.results-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(format.format(result.first.validVotes))
  await expect(panel).toContainText(format.format(result.second.validVotes))
  await expect(page.getByRole('table', { name: 'Comparação de votos por candidatura' })).toBeVisible()
}

test('both-round domestic journeys preserve summary-first layout, filters and shareable navigation', async ({ page }) => {
  await page.goto('/')
  await expectTotals(page, comparison('overall'))
  await page.getByRole('navigation', { name: 'Abrangência dos resultados' })
    .getByRole('button', { name: 'Brasil', exact: true }).click()
  await expectTotals(page, comparison('domestic'))
  const states = page.getByRole('table', { name: 'Resultados por estado' })
  await expect(states.getByRole('row')).toHaveCount(109)
  expect(await page.locator('.results-panel').evaluate((element) =>
    Boolean(element.compareDocumentPosition(document.querySelector('.geography-table-card')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true)
  await page.getByLabel('Buscar estado', { exact: true }).fill('sao')
  await expect(states.getByRole('row')).toHaveCount(5)
  await expect(page).toHaveURL(/\?visao=brasil$/)
  await expectTotals(page, comparison('domestic'))
  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await page.getByLabel('Estado', { exact: true }).selectOption('sp')
  await expect(states.getByRole('row')).toHaveCount(5)
  await states.getByRole('link', { name: 'SÃO PAULO', exact: true }).click()
  await expectTotals(page, comparison('state:sp'))
  await page.getByLabel('Município', { exact: true }).selectOption('71072')
  await expect(page).toHaveURL(/visao=brasil&uf=sp&municipio=71072/)
  await expectTotals(page, comparison('municipality:sp:71072'))
  await page.reload()
  await expectTotals(page, comparison('municipality:sp:71072'))
  await page.goBack()
  await expect(page).toHaveURL(/visao=brasil&uf=sp$/)
  await expectTotals(page, comparison('state:sp'))
})

test('country tables show totals and both finalists together while sorting stays table-only', async ({ page }) => {
  await page.goto('/?visao=exterior')
  await expectTotals(page, comparison('overseas'))
  const countries = page.getByRole('table', { name: 'Resultados por país de votação' })
  await expect(countries.getByRole('row')).toHaveCount(summary.metadata.countries.length * 4 + 1)
  await page.getByLabel('País de votação', { exact: true }).selectOption('portugal')
  await expect(countries.getByRole('row')).toHaveCount(5)
  const lula = summary.finalists.find((candidate) => candidate.number === '13')
  if (!lula) throw new Error('Missing canonical Lula identity')
  await page.getByLabel('Ordenar valores de', { exact: true }).selectOption(lula.id)
  const portugal = comparison('country:portugal')
  const group = countries.getByRole('rowgroup', { name: 'Comparação: Portugal' })
  const rows = group.getByRole('row')
  await expect(rows.nth(0)).toContainText(format.format(portugal.first.validVotes))
  for (const [index, candidate] of summary.finalists.entries()) {
    await expect(rows.nth(index + 1)).toContainText(candidate.name)
    await expect(rows.nth(index + 1)).toContainText(format.format(portugal.first.votes[candidate.id]!))
    await expect(rows.nth(index + 1)).toContainText(format.format(portugal.second.votes[candidate.id]!))
  }
  await expect(rows.nth(3)).toContainText('Outros')
  await expect(rows.nth(3)).toContainText(format.format(portugal.first.otherVotes))
  for (const index of [2, 3, 4]) await expect(rows.nth(3).getByRole('cell').nth(index - 1)).toHaveText('—')
  await page.setViewportSize({ width: 360, height: 900 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page).toHaveURL(/\?visao=exterior$/)
  await expectTotals(page, comparison('overseas'))
  await countries.getByRole('link', { name: 'Portugal', exact: true }).click()
  await expect(page).toHaveURL(/visao=exterior&pais=portugal/)
  await expectTotals(page, portugal)
})

test('initial views do not fetch city shards, live feeds or poll; cities share one state shard', async ({ page }) => {
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await page.clock.install()
  await page.goto('/')
  await expectTotals(page, comparison('overall'))
  const shardUrls = Object.values(manifest.municipalities).map((resource) => `/data/2026/${resource.path}`)
  expect(requested.filter((url) => shardUrls.some((suffix) => url.endsWith(suffix)))).toHaveLength(0)
  await page.getByRole('button', { name: 'Exterior', exact: true }).click()
  await expectTotals(page, comparison('overseas'))
  const count = requested.length
  await page.clock.fastForward('02:00')
  expect(requested).toHaveLength(count)
  await page.goto('/?visao=brasil&uf=sp')
  await expectTotals(page, comparison('state:sp'))
  const resource = manifest.municipalities.sp!
  const shardSuffix = `/data/2026/${resource.path}`
  await page.getByLabel('Município', { exact: true }).selectOption('71072')
  await expectTotals(page, comparison('municipality:sp:71072'))
  const other = sp.comparisons.find((item) => item.geography.id !== 'municipality:sp:71072')
  if (!other) throw new Error('Missing second city for shard cache test')
  await page.getByLabel('Município', { exact: true }).selectOption(other.geography.id.split(':')[2]!)
  await expectTotals(page, other)
  expect(requested.filter((url) => url.endsWith(shardSuffix))).toHaveLength(1)
  expect(requested.some((url) => url.includes('resultados.tse.jus.br'))).toBe(false)
})

test('tampered static data and malformed navigation fail explicitly instead of displaying zeros', async ({ page }) => {
  await page.route(`**/data/2026/${manifest.summary.path}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...summary, version: 'tampered-version' }),
    })
  })
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText(/integridade|hash|SHA-256|tamanho|verifica|versão|inválid/i)
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.goto('/?visao=brasil&municipio=71072')
  await expect(page.getByRole('alert')).toContainText(/endereço|localidade/i)
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('missing municipality data never reuses the parent result or invents a comparison', async ({ page }) => {
  const resource = manifest.municipalities.sp!
  await page.route(`**/data/2026/${resource.path}`, (route) =>
    route.fulfill({ status: 404, body: 'Unavailable test shard' }),
  )
  await page.goto('/?visao=brasil&uf=sp&municipio=71072')
  await expect(page.getByRole('alert')).toContainText(/indisponível|404|carregar/i)
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('two stacked charts retain party colors and exact midpoint on desktop and mobile', async ({ page }) => {
  await page.goto('/')
  await expectTotals(page, comparison('overall'))
  const charts = page.locator('.results-stack-track')
  await expect(charts).toHaveCount(2)
  const colors = await charts.first().locator('.results-stack-segment').evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).backgroundColor),
  )
  expect(colors.slice(0, 2)).toEqual(['rgb(196, 30, 58)', 'rgb(21, 94, 171)'])
  expect(colors).toHaveLength(3)
  await expect(charts.nth(1).locator('.results-stack-segment')).toHaveCount(2)
  const candidates = page.getByRole('table', { name: 'Comparação de votos por candidatura' })
  await expect(candidates.getByRole('row')).toHaveCount(4)
  await expect(candidates.getByRole('row').last()).toContainText('Outros')
  await expect(candidates.getByRole('row').last()).toContainText(format.format(comparison('overall').first.otherVotes))
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 })
    const headings = await candidates.locator('thead button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const range = document.createRange()
        range.selectNodeContents(button.firstChild!)
        return {
          lines: range.getClientRects().length,
          textWidth: range.getBoundingClientRect().width,
          availableWidth: button.getBoundingClientRect().width,
        }
      }),
    )
    for (const heading of headings) {
      expect(heading.lines).toBe(1)
      expect(heading.textWidth).toBeGreaterThan(0)
      expect(heading.textWidth).toBeLessThan(heading.availableWidth)
    }
    if (width === 1280) {
      expect(await candidates.evaluate((table) =>
        table.scrollWidth <= table.parentElement!.clientWidth + 1,
      )).toBe(true)
    }
    for (const chart of await charts.all()) {
      const geometry = await chart.evaluate((element) => {
        const track = element.getBoundingClientRect()
        const marker = element.querySelector('.results-midpoint')!.getBoundingClientRect()
        const segments = [...element.querySelectorAll('.results-stack-segment')]
        return {
          trackWidth: track.width,
          midpointDifference: Math.abs(marker.x + marker.width / 2 - track.x - track.width / 2),
          segmentWidth: segments.reduce((sum, segment) => sum + segment.getBoundingClientRect().width, 0),
        }
      })
      expect(geometry.midpointDifference).toBeLessThan(0.1)
      expect(geometry.segmentWidth).toBeCloseTo(geometry.trackWidth, 0)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  const header = candidates.getByRole('columnheader').filter({ has: page.getByRole('button') }).first()
  await header.getByRole('button').focus()
  await page.keyboard.press('Enter')
  const direction = await header.getAttribute('aria-sort')
  await page.keyboard.press('Space')
  expect(await header.getAttribute('aria-sort')).not.toBe(direction)
})

test('runoff map uses each state winner, supports keyboard navigation and keeps source details collapsed last', async ({ page }) => {
  await page.goto('/')
  await expectTotals(page, comparison('overall'))
  const map = page.getByRole('group', { name: 'Mapa do Brasil por UF' })
  await expect(map.getByRole('link')).toHaveCount(27)
  const colors = new Set<string>()
  for (const state of summary.metadata.states) {
    const result = comparison(`state:${state.code}`).second
    const winner = [...summary.finalists].sort((a, b) => result.votes[b.id]! - result.votes[a.id]!)[0]!
    const link = map.locator(`[data-state="${state.code}"]`)
    await expect(link).toHaveAttribute('data-winner', winner.id)
    await expect(link).toHaveAccessibleName(new RegExp(winner.name))
    const color = winner.party === 'PT' ? '#c41e3a' : '#155eab'
    await expect(link.locator('path')).toHaveAttribute('fill', color)
    colors.add(color)
  }
  expect(colors.size).toBe(2)
  const sources = page.locator('.results-provenance')
  await expect(sources).not.toHaveAttribute('open', '')
  expect(await page.locator('.results-source-footer').evaluate((element) => element.nextElementSibling === null)).toBe(true)
  const disclosure = sources.locator('summary')
  await disclosure.focus()
  await page.keyboard.press('Enter')
  await expect(sources).toHaveAttribute('open', '')
  await expect(sources.getByRole('region', { name: 'Fonte e cédulas do 1º turno' })).toBeVisible()
  await page.getByRole('button', { name: 'Brasil', exact: true }).click()
  await expectTotals(page, comparison('domestic'))
  await expect(sources).not.toHaveAttribute('open', '')
  expect(await page.locator('.state-map-card').evaluate((element) =>
    Boolean(element.compareDocumentPosition(document.querySelector('.geography-table-card')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true)
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(map).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  const df = page.getByRole('navigation', { name: 'Alternativa ao mapa: selecionar UF' }).getByRole('link', { name: /DISTRITO FEDERAL/ })
  await df.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/visao=brasil&uf=df/)
  await expect(map).toHaveCount(0)
  await expectTotals(page, comparison('state:df'))
  await page.goto('/?visao=exterior')
  await expectTotals(page, comparison('overseas'))
  await expect(map).toHaveCount(0)
  await page.goto('/')
  await expect(map).toBeVisible()
  await map.locator('[data-state="sp"]').focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/visao=brasil&uf=sp/)
  await expectTotals(page, comparison('state:sp'))
})
