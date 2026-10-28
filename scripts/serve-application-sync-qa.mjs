/** 仅本机、临时数据的真实双 origin IndexedDB/HTTP 验收入口；不启动浏览器。 */
import {createServer, request} from 'node:http'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, resolve, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {randomBytes} from 'node:crypto'
import {createServer as createViteServer} from 'vite'
import {createKeyring} from '@tulai-design/sync-sdk/crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serviceRoot = process.env.TULAI_SYNC_REPO || resolve(root, '../tulai-sync')
const {openStore} = await import(pathToFileURL(join(serviceRoot, 'apps/server/store.mjs')))
const {createSyncServer} = await import(pathToFileURL(join(serviceRoot, 'apps/server/http.mjs')))
const dir = await mkdtemp(join(tmpdir(), 'dada-application-sync-'))
const runId = 'qa-' + randomBytes(8).toString('hex')
const scope = {appId: 'dada-qa', spaceId: runId}, keyring = createKeyring(scope)
const devices = ['a', 'b'].map(id => ({id: 'device-' + id, token: randomBytes(32).toString('base64url'), scopes: [scope]}))
const store = openStore({filename: join(dir, 'sync.sqlite')})
const service = createSyncServer({store, devices})
const listen = server => new Promise((ok, fail) => {server.once('error', fail); server.listen(0, '127.0.0.1', () => {server.off('error', fail); ok()})})
const origin = server => `http://127.0.0.1:${server.address().port}`
const sites = [], vites = []
const stats = {runId, requests: 0, commits: 0, commitBodyBytes: 0, objectCreates: 0, objectChunkPuts: 0, objectChunkBytes: 0, objectCompletes: 0, objectChunkGets: 0, totalRequestBodyBytes: 0}
let closing = false
async function close() {
  if (closing) return
  closing = true
  for (const vite of vites) await vite.close()
  for (const server of [...sites, service]) {server.closeAllConnections(); await new Promise(ok => server.close(ok))}
  store.close()
  await rm(dir, {recursive: true, force: true})
}
try {
  await listen(service)
  for (const [index, device] of devices.entries()) {
    const vite = await createViteServer({root, configFile: false, server: {middlewareMode: true, hmr: false, ws: false}, optimizeDeps: {entries: ['tests/application-sync-worker.html', 'tests/application-sync-regressions.html']}, appType: 'mpa', logLevel: 'warn'})
    vites.push(vite)
    const site = createServer((req, res) => {
      const path = new URL(req.url, 'http://localhost').pathname
      if (path === '/__qa/config') {
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'})
        res.end(JSON.stringify({runId, scope, keyring, deviceId: device.id, token: device.token, baseUrl: origin(site) + '/__sync', origin: origin(site), peerOrigin: origin(sites[1 - index])})); return
      }
      if (path === '/__qa/stats') {
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(stats)); return
      }
      if (path.startsWith('/__sync/')) {
        const target = req.url.slice('/__sync'.length)
        stats.requests++
        const commit = req.method === 'POST' && path.endsWith('/commits')
        const chunk = req.method === 'PUT' && /\/uploads\/[^/]+\/chunks\//.test(path)
        if (commit) stats.commits++
        if (chunk) stats.objectChunkPuts++
        if (req.method === 'POST' && path.endsWith('/uploads')) stats.objectCreates++
        if (req.method === 'POST' && path.endsWith('/complete')) stats.objectCompletes++
        if (req.method === 'GET' && /\/objects\/[^/]+\/chunks\//.test(path)) stats.objectChunkGets++
        req.on('data', bytes => {stats.totalRequestBodyBytes += bytes.length; if (commit) stats.commitBodyBytes += bytes.length; if (chunk) stats.objectChunkBytes += bytes.length})
        const proxy = request(origin(service) + target, {method: req.method, headers: {...req.headers, host: new URL(origin(service)).host}}, upstream => {
          res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res)
        })
        proxy.on('error', () => {if (!res.headersSent) res.writeHead(502); res.end()})
        req.on('aborted', () => proxy.destroy())
        req.pipe(proxy); return
      }
      vite.middlewares(req, res, () => {res.writeHead(404); res.end()})
    })
    sites.push(site); await listen(site)
  }
  process.on('SIGINT', () => void close())
  process.on('SIGTERM', () => void close())
  process.stdout.write(`Application Sync QA: ${origin(sites[0])}/tests/application-sync-regressions.html\n`)
  process.stdout.write(`Peer origin: ${origin(sites[1])}\n`)
} catch (error) {await close(); throw error}
