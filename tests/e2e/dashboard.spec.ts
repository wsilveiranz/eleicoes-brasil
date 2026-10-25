import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const fixtures = path.join(process.cwd(), 'tests', 'fixtures')
const format = new Intl.NumberFormat('pt-BR')

async function fixture(name: string) {
  return await readFile(path.join(fixtures, name), 'utf8')
}

async function mockOfficialFeeds(page: Page, overallOverride?: () => string | null) {
  await page.route('https://resultados.tse.jus.br/oficial/**', async (route) => {
    const url = new URL(route.request().url())
    const name = url.pathname.split('/').at(-1)
    let file: string
    if (name === 'ele-c.jws') {
      file = 'elections.jws'
    } else if (name === 'mun-e006258-cm.jws') {
      file = 'municipalities.jws'
    } else if (name === 'br-c0001-e006258-u.jws') {
      const override = overallOverride?.()
      if (override !== undefined && override !== null) {
        await route.fulfill({ status: 200, contentType: 'application/jose', body: override })
        return
      }
      file = 'overall.jws'
    } else if (name === 'zz-c0001-e006258-u.jws') {
      file = 'overseas.jws'
    } else {
      const match = name?.match(/^([a-z]{2})(\d{5})?-c0001-e006258-u\.jws$/)
      if (!match) throw new Error(`Unexpected official request: ${url}`)
      file = match[2]
        ? match[1] === 'zz'
          ? `locality-zz${match[2]}.jws`
          : `municipality-${match[1]}${match[2]}.jws`
        : `state-${match[1]}.jws`
    }
    let body: string
    try {
      body = await fixture(file)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      await route.fulfill({ status: 404, body: 'Fixture unavailable' })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/jose',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body,
    })
  })
}

function payload(jws: string): { v: { vv: string } } {
  const part = jws.trim().split('.')[1]
  if (!part) throw new Error('Invalid test fixture')
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

async function expectValidVotes(page: Page, expected: number) {
  const table = page.getByRole('table', { name: 'Votos por candidatura · percentuais dos votos válidos' })
  await expect(table.getByRole('row', { name: /Total de votos válidos/ }))
    .toContainText(format.format(expected))
}

test('overall, domestic, state and municipality journeys preserve shareable navigation', async ({ page }) => {
  await mockOfficialFeeds(page)
  await page.goto('/')
  await expectValidVotes(page, Number(payload(await fixture('overall.jws')).v.vv))
  const scopes = page.getByRole('navigation', { name: 'Abrangência dos resultados' })
  await scopes.getByRole('button', { name: 'Brasil', exact: true }).click()
  const metadata = JSON.parse(await fixture('municipalities.json')) as { abr: { cd: string }[] }
  const stateResults = await Promise.all(metadata.abr.filter((state) => state.cd !== 'zz')
    .map(async (state) => Number(payload(await fixture(`state-${state.cd}.jws`)).v.vv)))
  await expectValidVotes(page, stateResults.reduce((total, votes) => total + votes, 0))
  const stateTable = page.getByRole('table', { name: 'Resultados por estado' })
  await expect(stateTable.getByRole('row')).toHaveCount(28)
  await expect(stateTable.getByRole('row', { name: /SÃO PAULO/ })).toContainText(/votos/)
  await expect(stateTable.getByRole('row', { name: /DISTRITO FEDERAL/ })).toContainText(/dos válidos/)
  const summary = page.getByRole('region', { name: 'Votos para presidente' })
  expect(await summary.evaluate((element) =>
    Boolean(element.compareDocumentPosition(document.querySelector('.geography-table-card')!) & Node.DOCUMENT_POSITION_FOLLOWING),
  )).toBe(true)
  await page.getByLabel('Buscar estado', { exact: true }).fill('sao')
  await expect(stateTable.getByRole('row')).toHaveCount(2)
  await expect(page).toHaveURL(/\?visao=brasil$/)
  await expectValidVotes(page, stateResults.reduce((total, votes) => total + votes, 0))
  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await page.getByLabel('Estado', { exact: true }).selectOption('sp')
  await expect(stateTable.getByRole('row')).toHaveCount(2)
  await expect(page).toHaveURL(/\?visao=brasil$/)
  await stateTable.getByRole('link', { name: 'SÃO PAULO', exact: true }).click()
  await expectValidVotes(page, Number(payload(await fixture('state-sp.jws')).v.vv))
  await page.getByLabel('Município', { exact: true }).selectOption('71072')
  await expect(page).toHaveURL(/visao=brasil&uf=sp&municipio=71072/)
  const cityVotes = Number(payload(await fixture('municipality-sp71072.jws')).v.vv)
  await expectValidVotes(page, cityVotes)
  await page.reload()
  await expectValidVotes(page, cityVotes)
  await page.goBack()
  await expect(page).toHaveURL(/visao=brasil&uf=sp$/)
  await expectValidVotes(page, Number(payload(await fixture('state-sp.jws')).v.vv))
})

test('overseas and Portugal use the complete official constituent results', async ({ page }) => {
  await mockOfficialFeeds(page)
  await page.goto('/?visao=exterior')
  await expectValidVotes(page, Number(payload(await fixture('overseas.jws')).v.vv))
  const countries = page.getByRole('table', { name: 'Resultados por país de votação' })
  await expect(countries.getByRole('row')).toHaveCount(134)
  await expect(countries.getByRole('row', { name: /Portugal/ })).toContainText(/votos/)
  await expect(countries.getByRole('row', { name: /Albânia/ })).toContainText(/Indisponível/)
  await page.setViewportSize({ width: 360, height: 800 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByLabel('País de votação', { exact: true }).selectOption('portugal')
  await expect(countries.getByRole('row')).toHaveCount(2)
  await expect(page).toHaveURL(/\?visao=exterior$/)
  await expectValidVotes(page, Number(payload(await fixture('overseas.jws')).v.vv))
  await countries.getByRole('link', { name: 'Portugal', exact: true }).click()
  const mapping = JSON.parse(await readFile(
    path.join(process.cwd(), 'src', 'data', 'geography', 'countries.json'), 'utf8',
  )) as { countries: { id: string; localityCodes: string[] }[] }
  const country = mapping.countries.find((item) => item.id === 'portugal')
  if (!country) throw new Error('Missing official Portugal mapping')
  const counts = await Promise.all(country.localityCodes.map(async (code) =>
    Number(payload(await fixture(`locality-zz${code}.jws`)).v.vv),
  ))
  await expectValidVotes(page, counts.reduce((total, value) => total + value, 0))
  await expect(page).toHaveURL(/visao=exterior&pais=portugal/)
  await expect(page.getByText(/3 de 3/)).toBeVisible()
})

test('invalid signatures and malformed navigation never look like valid zero results', async ({ page }) => {
  const signed = (await fixture('overall.jws')).trim()
  const [header, body, signature] = signed.split('.')
  if (!header || !body || !signature) throw new Error('Invalid fixture')
  const modifiedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`
  await mockOfficialFeeds(page, () => `${header}.${body}.${modifiedSignature}`)
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText(/assinatura|verifica|autentic/i)
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.goto('/?visao=brasil&municipio=71072')
  await expect(page.getByRole('alert')).toContainText(/endereço|localidade/i)
  await expect(page.getByRole('table')).toHaveCount(0)
})

test('small-screen layout stays within the viewport and table sorting is keyboard accessible', async ({ page }) => {
  await mockOfficialFeeds(page)
  await page.setViewportSize({ width: 360, height: 800 })
  await page.goto('/')
  await expect(page.getByRole('table')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const votesHeading = page.getByRole('columnheader', { name: 'Votos', exact: true })
  await votesHeading.getByRole('button').focus()
  await page.keyboard.press('Enter')
  await expect(votesHeading).toHaveAttribute('aria-sort', 'ascending')
  await page.keyboard.press('Space')
  await expect(votesHeading).toHaveAttribute('aria-sort', 'descending')
})

test('a failed refresh retains the last successful snapshot with an explicit warning', async ({ page }) => {
  await mockOfficialFeeds(page)
  await page.goto('/')
  const votes = Number(payload(await fixture('overall.jws')).v.vv)
  await expectValidVotes(page, votes)
  await page.route('**/dados/br/br-c0001-e006258-u.jws', async (route) => {
    await route.fulfill({ status: 503, body: 'Temporarily unavailable' })
  })
  await page.getByRole('button', { name: 'Atualizar agora', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/últim|desatualizad/i, { timeout: 15_000 })
  await expectValidVotes(page, votes)
})
