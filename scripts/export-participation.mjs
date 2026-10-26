import { createServer } from 'vite'
const server = await createServer({
  server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom',
})
try {
  const module = await server.ssrLoadModule('/scripts/export-participation.ts')
  await module.run()
} finally {
  await server.close()
}
