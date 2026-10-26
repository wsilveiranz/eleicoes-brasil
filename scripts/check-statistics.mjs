import { readFile } from 'node:fs/promises'
import { URL } from 'node:url'
import console from 'node:console'
import { createServer } from 'vite'
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
})
try {
  const { parseParticipation, parseAgeData } = await server.ssrLoadModule('/src/data/statistics.ts')
  const root = new URL('../public/data/2026/', import.meta.url)
  const read = async (file) => JSON.parse(await readFile(new URL(file, root), 'utf8'))
  const manifest = await read('manifest.json')
  const participation = parseParticipation(await read('participation.json'), manifest.version)
  const age = parseAgeData(await read('age-turnout.json'))
  console.log(JSON.stringify({
    datasetVersion: participation.datasetVersion, firstAge: age.first.status,
    secondAge: age.second.status, checkedAt: age.checkedAt, refresh: age.refresh,
  }))
} finally {
  await server.close()
}
