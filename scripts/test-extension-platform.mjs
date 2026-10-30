import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const compile = file => ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
const tick = () => new Promise(resolve => setImmediate(resolve))
function harness(respond) {
  let granted = false, promptResult = true, prompts = 0, containsCalls = 0
  const calls = []
  const api = {runtime: {id: 'fixture'}, permissions: {
    contains: async () => {containsCalls++; return granted},
    request: () => {prompts++; granted = promptResult; return Promise.resolve(promptResult)},
  }}
  const platform = {exports: {}}
  const context = {module: platform, exports: platform.exports, location: {protocol: 'chrome-extension:', host: 'fixture', href: 'chrome-extension://fixture/index.html'}, chrome: api}
  vm.runInNewContext(compile('src/lib/platform.ts'), context)
  const module = {exports: {}}
  const globals = {
    module, exports: module.exports, URL, Request, Response, DOMException, Error, setTimeout, clearTimeout,
    location: context.location,
    require: name => name === './platform' ? platform.exports : {useSyncExternalStore() {}},
    fetch: async (input, init) => {calls.push({input, init}); return respond ? respond(input, init) : new Response('data: hello\n\n', {headers: {'content-type': 'text/event-stream'}})},
  }
  vm.runInNewContext(compile('src/lib/extensionNetwork.ts'), globals)
  module.exports.installExtensionFetch()
  return {network: module.exports, platform: platform.exports, fetch: globals.fetch, calls, setGranted: value => {granted = value}, setPrompt: value => {promptResult = value}, get prompts() {return prompts}, get containsCalls() {return containsCalls}}
}
let count = 0
async function test(name, work) {await work(); count++; console.log(`通过：${name}`)}

await test('未授权来源按主机合并等待，点击后保留POST凭据、响应和流', async () => {
  const h = harness()
  const first = h.fetch('https://api.example:8443/v1/chat', {method: 'POST', headers: {authorization: 'Bearer synthetic'}, body: '{"stream":true}'})
  const second = h.fetch('https://api.example/v1/models')
  await tick()
  assert.equal(h.calls.length, 0)
  const requests = h.network.getExtensionNetworkRequests()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].origin, 'https://api.example')
  const approval = h.network.approveExtensionNetworkRequest(requests[0].id)
  assert.equal(h.prompts, 1, 'permissions.request 必须在调用时同步发起')
  await approval
  const [response] = await Promise.all([first, second])
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  assert.equal(await response.text(), 'data: hello\n\n')
  assert.equal(h.calls[0].init.headers.authorization, 'Bearer synthetic')
  assert.equal(h.calls[0].init.body, '{"stream":true}')
  assert.equal(h.network.getExtensionNetworkRequests().length, 0)
})
await test('拒绝浏览器授权不会发网络，撤销后重新要求授权', async () => {
  const h = harness(); h.setPrompt(false)
  const request = h.fetch('https://refused.example/data')
  const rejected = assert.rejects(request, /未允许连接/)
  await tick()
  await h.network.approveExtensionNetworkRequest(h.network.getExtensionNetworkRequests()[0].id)
  await rejected
  assert.equal(h.calls.length, 0)
  h.setGranted(true)
  await h.fetch('https://refused.example/data')
  h.setGranted(false)
  const retried = h.fetch('https://refused.example/data')
  const canceled = assert.rejects(retried, /已取消连接/)
  await tick()
  h.network.rejectExtensionNetworkRequest(h.network.getExtensionNetworkRequests()[0].id)
  await canceled
  assert.equal(h.calls.length, 1)
  assert.equal(h.containsCalls, 3)
})
await test('取消单个请求不会取消同来源其他请求，最后取消时移除提示', async () => {
  const h = harness(), controller = new AbortController()
  const one = h.fetch('https://shared.example/a', {signal: controller.signal})
  const rejected = assert.rejects(one, error => error.name === 'AbortError')
  const two = h.fetch('https://shared.example/b')
  await tick(); controller.abort(); await rejected
  assert.equal(h.network.getExtensionNetworkRequests().length, 1)
  await h.network.approveExtensionNetworkRequest(h.network.getExtensionNetworkRequests()[0].id)
  await two
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].input, 'https://shared.example/b')
})
await test('内置取数代理在扩展直连，Request/取消信号保持，包内资源不申请主机权限', async () => {
  const h = harness(); h.setGranted(true)
  const controller = new AbortController()
  const request = new Request('chrome-extension://fixture/__proxy?url=https%3A%2F%2Ffeed.example%2Frss', {headers: {accept: 'application/xml'}, signal: controller.signal})
  await h.fetch(request)
  assert.equal(h.calls[0].input.url, 'https://feed.example/rss')
  assert.equal(h.calls[0].input.headers.get('accept'), 'application/xml')
  await h.fetch('/assets/local.wasm')
  assert.equal(h.containsCalls, 1)
  await assert.rejects(h.fetch('/__proxy?url=file%3A%2F%2F%2Fetc%2Fpasswd'), /仅支持/)
})
await test('真实RSS取数在浏览器授权之后才开始15秒业务超时', async () => {
  const h = harness(), module = {exports: {}}
  let timers = 0
  vm.runInNewContext(compile('src/lib/rss.ts'), {
    module, exports: module.exports,
    require: name => name === './platform' ? h.platform : {},
    AbortController, fetch: (...args) => h.fetch(...args),
    setTimeout: (...args) => {timers++; return setTimeout(...args)}, clearTimeout,
  })
  const reading = module.exports.fetchSourceText('https://feed.example/rss', '/__proxy?url={url}', 'application/xml', '测试订阅')
  await tick()
  assert.equal(timers, 0)
  assert.equal(h.calls.length, 0)
  await h.network.approveExtensionNetworkRequest(h.network.getExtensionNetworkRequests()[0].id)
  assert.equal(await reading, 'data: hello\n\n')
  assert.equal(timers, 1)
})
await test('外部默认重定向在下一跳发送前停止，显式manual/error与包内资源语义保留', async () => {
  const h = harness(() => ({type: 'opaqueredirect'})); h.setGranted(true)
  await assert.rejects(h.fetch('https://allowed.example/start'), /最终地址/)
  assert.equal(h.calls[0].init.redirect, 'manual')
  assert.equal((await h.fetch(new Request('https://allowed.example/start', {redirect: 'manual'}))).type, 'opaqueredirect')
  assert.equal(h.calls[1].input.redirect, 'manual')
  assert.equal(h.calls[1].init, undefined)
  await h.fetch('https://allowed.example/start', {redirect: 'error'})
  assert.equal(h.calls[2].init.redirect, 'error')
  await h.fetch('/assets/local.wasm')
  assert.equal(h.calls[3].init, undefined)
})
const manifest = JSON.parse(readFileSync(new URL('../browser-extension/manifest.json', import.meta.url), 'utf8'))
assert.equal(manifest.manifest_version, 3)
assert.equal(manifest.chrome_url_overrides.newtab, 'index.html')
assert.deepEqual([...manifest.sandbox.pages].sort(), ['sandbox.html', 'spline.html'])
assert.ok(!manifest.content_security_policy.extension_pages.includes("'unsafe-eval'"))
assert.ok(!manifest.content_security_policy.sandbox.includes('allow-same-origin'))
assert.ok(!manifest.permissions.includes('tabs') && !manifest.permissions.includes('history'))
assert.ok(manifest.permissions.includes('notifications'))
console.log(`扩展平台回归全部通过：${count}/${count}`)
