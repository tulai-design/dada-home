import assert from 'node:assert/strict'
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import path from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const temporary = await mkdtemp(path.join(tmpdir(), 'dada-network-regression-'))
const extension = path.join(temporary, 'extension')
let redirectedRequests = 0
const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  if (req.url === '/redirect') {
    res.writeHead(302, {location: `http://localhost:${server.address().port}/unapproved`})
    res.end()
  } else if (req.url === '/unapproved') {
    redirectedRequests++
    res.end('must-not-be-requested')
  } else res.end('allowed-response')
})
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve))
let context
try {
  await cp(new URL('../dist-extension/', import.meta.url), extension, {recursive: true})
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'))
  delete manifest.chrome_url_overrides
  delete manifest.action
  manifest.host_permissions = ['http://127.0.0.1/*']
  manifest.background = {service_worker: 'probe-background.js'}
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(path.join(extension, 'probe-background.js'), 'chrome.runtime.onInstalled.addListener(()=>{})')
  const compile = async file => ts.transpileModule(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  await writeFile(path.join(extension, 'probe.js'), [
    `const platform = (()=>{const module={exports:{}};const exports=module.exports;${await compile('src/lib/platform.ts')};return module.exports})();`,
    `(()=>{const module={exports:{}};const exports=module.exports;const require=name=>name==='./platform'?platform:{useSyncExternalStore(){}};${await compile('src/lib/extensionNetwork.ts')};module.exports.installExtensionFetch()})();`,
  ].join('\n'))
  await writeFile(path.join(extension, 'probe.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="probe.js"></script></body></html>')
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]})
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/probe.html`)
  const result = await page.evaluate(async port => {
    const base = `http://127.0.0.1:${port}`
    const approved = await chrome.permissions.contains({origins: ['http://localhost/*']})
    const direct = await fetch(base + '/direct').then(response => response.text())
    const redirectError = await fetch(base + '/redirect').then(() => 'unexpected-success', error => error.message)
    const manual = await fetch(base + '/redirect', {redirect: 'manual'}).then(response => response.type)
    const explicitError = await fetch(base + '/redirect', {redirect: 'error'}).then(() => false, () => true)
    return {approved, direct, redirectError, manual, explicitError}
  }, server.address().port)
  assert.equal(result.approved, false)
  assert.equal(result.direct, 'allowed-response')
  assert.match(result.redirectError, /最终地址/)
  assert.equal(result.manual, 'opaqueredirect')
  assert.equal(result.explicitError, true)
  assert.equal(redirectedRequests, 0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({result, redirectedRequests, errors}, null, 2))
} finally {
  await context?.close()
  await new Promise(resolve => server.close(resolve))
  await rm(temporary, {recursive: true, force: true})
}
