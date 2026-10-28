import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 执行真实供应商模块，响应均由隔离 fetch 提供；不使用账号或真实网络。
function runtime(responder, options = {}) {
  const calls = [], modules = new Map()
  let now = 1_800_000_000_000
  class Clock extends Date {static now() {return now}}
  const fetch = async (url, init = {}) => {calls.push({url: String(url), ...init}); return responder(String(url), init, calls.length)}
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    const module = {exports: {}}
    modules.set(path, module.exports)
    const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText
    const require = id => {
      if (id.startsWith('.')) return load(new URL(id + '.ts', 'file:///' + path).pathname.slice(1))
      throw new Error('未提供测试依赖：' + id)
    }
    vm.runInNewContext(code, {module, exports: module.exports, require, fetch, URL, Headers, TextEncoder, TextDecoder, Uint8Array, AbortController, Date: Clock, btoa, atob, setTimeout, clearTimeout, ...options}, {filename: path})
    return module.exports
  }
  return {calls, load, api: () => load('src/lib/syncProviders.ts'), setTime(value) {now = value}, get now() {return now}}
}
const config = (backend = 'http', patch = {}) => ({backend, webdav: {url: 'https://dav.example/dada/', user: '', pass: '', proxy: ''}, gist: {token: 'synthetic-token', id: 'fixture-id'}, http: {url: 'https://sync.example/snapshot.json', token: '', proxy: ''}, secrets: false, passphrase: '', auto: false, device: 'fixture', ...patch})
const json = (value, init = {}) => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}, ...init})
const file = (entry) => ({id: 'fixture-id', files: {'dada-sync-v2.json': entry}})
const header = (call, key) => new Headers(call.headers).get(key)
let passed = 0
async function test(name, work) {await work(); passed += 1; console.log('通过：' + name)}

await test('WebDAV首次创建使用新文件名与If-None-Match，只有404视为缺失', async () => {
  const h = runtime((_, init) => init.method === 'PUT' ? new Response(null, {status: 201}) : new Response(null, {status: 404}))
  const remote = h.api().createRemote(config('webdav'))
  const read = await remote.read()
  assert.equal(read.text, null)
  assert.equal(read.version.kind, 'missing')
  assert.match(h.calls[0].url, /\/dada\/dada-sync-v2\.json$/)
  const write = await remote.write('{"new":true}', read.version)
  assert.equal(header(h.calls[1], 'if-none-match'), '*')
  assert.equal(write.bytes, new TextEncoder().encode('{"new":true}').byteLength)
})
await test('强ETag条件覆盖及412冲突；弱ETag更新如实声明无保护', async () => {
  const h = runtime((_, init) => init.method === 'PUT' ? new Response(null, {status: 412}) : new Response('{}', {headers: {etag: '"revision-1"'}}))
  const remote = h.api().createRemote(config())
  const read = await remote.read()
  assert.equal(read.version.kind, 'etag')
  await assert.rejects(remote.write('{}', read.version), error => error.conflict === true)
  assert.equal(header(h.calls[1], 'if-match'), '"revision-1"')
  const weak = runtime((_, init) => init.method === 'PUT' ? new Response(null, {status: 204}) : new Response('{}', {headers: {etag: 'W/"weak"'}}))
  const weakRemote = weak.api().createRemote(config())
  const weakRead = await weakRemote.read()
  assert.equal(weakRead.version.kind, 'unprotected')
  await weakRemote.write('{}', weakRead.version)
  assert.equal(header(weak.calls[1], 'if-match'), null)
})
await test('HTTP200空正文和服务器错误不伪装首次创建', async () => {
  const empty = runtime(() => new Response('  ', {status: 200}))
  await assert.rejects(empty.api().createRemote(config()).read(), /空|正文/)
  const failed = runtime(() => new Response('server failed', {status: 503}))
  await assert.rejects(failed.api().createRemote(config()).read(), error => error.retryAt > failed.now && /503/.test(error.message))
})
await test('Gist正文读取无CAS声明，元数据形状及文件列表截断严格检查', async () => {
  const h = runtime(() => json(file({content: '{"v":2}', truncated: false})))
  const read = await h.api().createRemote(config('gist')).read()
  assert.equal(read.text, '{"v":2}')
  assert.equal(read.version.kind, 'unprotected')
  assert.ok(read.bytes > 0)
  const absent = runtime(() => json({files: {}}))
  assert.equal((await absent.api().createRemote(config('gist')).read()).version.kind, 'missing')
  for (const body of [{}, {files: []}, {files: {}, truncated: true}, file({truncated: true}), file({content: 1})]) {
    const bad = runtime(() => json(body))
    await assert.rejects(bad.api().createRemote(config('gist')).read())
  }
  const missingId = runtime(() => new Response(null, {status: 404}))
  await assert.rejects(missingId.api().createRemote(config('gist')).read(), /Gist|GitHub/)
  assert.equal(missingId.calls.length, 1)
})
await test('Gist raw读取校验HTTP状态与HTTPS来源，下载不转发令牌', async () => {
  const rawUrl = 'https://gist.githubusercontent.com/fixture/id/raw/rev/dada-sync-v2.json'
  const h = runtime((url) => url.startsWith('https://api.github.com/') ? json(file({truncated: true, raw_url: rawUrl})) : new Response('{"large":true}'))
  const read = await h.api().createRemote(config('gist')).read()
  assert.equal(read.text, '{"large":true}')
  assert.equal(header(h.calls[1], 'authorization'), null)
  assert.ok(read.bytes > new TextEncoder().encode(read.text).byteLength)
  const failed = runtime(url => url.startsWith('https://api.github.com/') ? json(file({truncated: true, raw_url: rawUrl})) : new Response('error page', {status: 500}))
  await assert.rejects(failed.api().createRemote(config('gist')).read(), /500/)
  for (const raw_url of ['https://attacker.example/raw', 'http://gist.githubusercontent.com/raw', 'https://user:pass@gist.githubusercontent.com/raw']) {
    const bad = runtime(() => json(file({truncated: true, raw_url})))
    await assert.rejects(bad.api().createRemote(config('gist')).read())
    assert.equal(bad.calls.length, 1)
  }
})
await test('Gist API声明超量、流实际超量与损坏UTF8全部拒绝', async () => {
  const MAX = 8 * 1024 * 1024
  const declared = runtime(() => json(file({truncated: true, size: MAX + 1, raw_url: 'https://gist.githubusercontent.com/u/id/raw/file'})))
  await assert.rejects(declared.api().createRemote(config('gist')).read(), /大小|预算|超过|MiB/)
  assert.equal(declared.calls.length, 1)
  const stream = runtime(() => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(MAX)); controller.enqueue(new Uint8Array(1)); controller.close()}}), {headers: {'content-length': '1'}}))
  await assert.rejects(stream.api().createRemote(config('gist')).read(), /大小|预算|超过|MiB/)
  const utf8 = runtime(() => new Response(new Uint8Array([0xc3, 0x28])))
  await assert.rejects(utf8.api().createRemote(config()).read(), /UTF|编码|正文/)
})
await test('Gist403权限与限流区分；Retry-After冷却期间零网络', async () => {
  const denied = runtime(() => json({message: 'Forbidden'}, {status: 403}))
  await assert.rejects(denied.api().createRemote(config('gist')).read(), error => !error.retryAt && /403/.test(error.message))
  const limited = runtime(() => json({message: 'API rate limit exceeded'}, {status: 403, headers: {'retry-after': '60'}}))
  const api = limited.api(), remote = api.createRemote(config('gist'))
  await assert.rejects(remote.read(), error => error.retryAt === limited.now + 60_000)
  assert.equal(api.getProviderRetryAt(config('gist')), limited.now + 60_000)
  await assert.rejects(remote.read(), error => error.retryAt > limited.now)
  assert.equal(limited.calls.length, 1)
  limited.setTime(limited.now + 60_001)
  await assert.rejects(remote.read())
  assert.equal(limited.calls.length, 2)
})
await test('429支持HTTP日期、耗尽额度重置头和次级限流退避', async () => {
  for (const make of [
    now => ({status: 429, headers: {'retry-after': new Date(now + 120_000).toUTCString()}}),
    now => ({status: 403, headers: {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 120_000) / 1000)}}),
    () => ({status: 403}),
  ]) {
    let h
    h = runtime(() => json({message: 'You have exceeded a secondary rate limit'}, make(h.now)))
    await assert.rejects(h.api().createRemote(config('gist')).read(), error => error.retryAt >= h.now + 60_000)
  }
})
await test('raw次级限流连续失败指数退避，不被成功元数据读取重置', async () => {
  const rawUrl = 'https://gist.githubusercontent.com/u/id/raw/file'
  const h = runtime(url => url.startsWith('https://api.github.com/') ? json(file({truncated: true, raw_url: rawUrl})) : json({message: 'secondary rate limit'}, {status: 403}))
  const remote = h.api().createRemote(config('gist'))
  await assert.rejects(remote.read(), error => error.retryAt === h.now + 60_000)
  h.setTime(h.now + 60_001)
  await assert.rejects(remote.read(), error => error.retryAt === h.now + 120_000)
  assert.equal(h.calls.length, 4)
})
await test('有限超时中止fetch，错误不包含连接令牌', async () => {
  const timers = new Map(); let sequence = 0
  const h = runtime((_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), {setTimeout: fn => {const id = ++sequence; timers.set(id, fn); return id}, clearTimeout: id => timers.delete(id)})
  const pending = h.api().createRemote(config()).read()
  const rejection = assert.rejects(pending, /超时/)
  await Promise.resolve()
  for (const fire of [...timers.values()]) fire()
  await rejection
  assert.equal(h.calls[0].signal.aborted, true)
})
await test('Gist创建只返回校验后的ID，已有文件PATCH不假发If-Match', async () => {
  const h = runtime(() => json({id: 'created-id'}))
  const saved = await h.api().createRemote(config('gist', {gist: {token: 'synthetic-token', id: ''}})).write('{}', {kind: 'missing'})
  assert.equal(saved.createdGistId, 'created-id')
  assert.equal(h.calls[0].method, 'POST')
  assert.equal(JSON.parse(h.calls[0].body).public, false)
  assert.ok(JSON.parse(h.calls[0].body).files['dada-sync-v2.json'])
  const existing = runtime(() => json({id: 'fixture-id'}))
  await existing.api().createRemote(config('gist')).write('{}', {kind: 'etag', etag: '"not-cas"'})
  assert.equal(existing.calls[0].method, 'PATCH')
  assert.equal(header(existing.calls[0], 'if-match'), null)
  const bad = runtime(() => json({id: ''}))
  await assert.rejects(bad.api().createRemote(config('gist', {gist: {token: 'synthetic-token', id: ''}})).write('{}', {kind: 'missing'}))
})
await test('出站UTF8和Gist请求包装均计预算，超量在网络前拒绝', async () => {
  const h = runtime(() => json({id: 'fixture-id'}))
  const remote = h.api().createRemote(config('gist'))
  await assert.rejects(remote.write('界'.repeat(Math.floor(8 * 1024 * 1024 / 3) + 1), {kind: 'unprotected'}), /大小|预算|超过|MiB/)
  await assert.rejects(remote.write('"'.repeat(5 * 1024 * 1024), {kind: 'unprotected'}), /大小|预算|超过|MiB/)
  assert.equal(h.calls.length, 0)
})
await test('HTTP创建409返回冲突，无效地址与只读内置代理在请求前拒绝', async () => {
  const h = runtime(() => new Response(null, {status: 409}))
  await assert.rejects(h.api().createRemote(config()).write('{}', {kind: 'missing'}), error => error.conflict === true)
  const invalid = runtime(() => {throw new Error('不应请求')})
  for (const url of ['file:///snapshot', 'javascript:alert(1)', 'https://name:secret@sync.example/data']) {
    assert.throws(() => invalid.api().createRemote(config('http', {http: {url, token: '', proxy: ''}})))
  }
  assert.throws(() => invalid.api().createRemote(config('http', {http: {url: 'https://sync.example/data', token: '', proxy: 'https://dada.example/__proxy?url={url}'}})), /代理|只读/)
  assert.equal(invalid.calls.length, 0)
})
console.log(`同步网络边界回归全部通过：${passed}/${passed}`)
