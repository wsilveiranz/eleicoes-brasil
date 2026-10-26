import { createServer } from 'vite'
import { argv } from 'node:process'
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({
  args: argv.slice(2), allowPositionals: true,
  options: { capture: { type: 'string' } },
})
if (positionals.length > 1) throw new Error('Expected import or validate, optionally --capture <name>.')
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
})
try {
  const module = await server.ssrLoadModule('/scripts/election-data.ts')
  await module.run(positionals[0] ?? 'validate', values.capture)
} finally {
  await server.close()
}
