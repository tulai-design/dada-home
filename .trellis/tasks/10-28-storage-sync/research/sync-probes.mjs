// 2026-10-28 同步现状探针。只读取真实 sync.ts，使用内存存储和网络替身。
// 这些断言锁定观察到的问题，不是产品验收通过；修复后应改写为期望行为的正式回归。
// 不加入 package.json test，不访问用户浏览器、配置、真实远端。
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import ts from 'typescript'

const source = readFileSync(new URL('../../../../src/lib/sync.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText

class MemoryStorage {
  values = new Map()
  get length() { return this.values.size }
  key(index) { return [...this.values.keys()][index] ?? null }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

function harness({fetch, initial = {}, now = 1000, stores = {kv: [], convs: [], turns: []}, dbUnavailable = false} = {}) {
  const storage = new MemoryStorage()
  for (const [key, value] of Object.entries(initial)) storage.setItem(key, JSON.stringify(value))
  const state = {now, dbUnavailable, stores: structuredClone(stores)}
  const db = {
    all: async (name) => state.dbUnavailable ? [] : structuredClone(state.stores[name]),
    put: async (name, value) => {
      if (state.dbUnavailable) return
      const key = name === 'kv' ? 'k' : 'id'
      state.stores[name] = state.stores[name].filter((row) => row[key] !== value[key])
      state.stores[name].push(structuredClone(value))
    },
    del: async (name, id) => {
      if (state.dbUnavailable) return
      const key = name === 'kv' ? 'k' : 'id'
      state.stores[name] = state.stores[name].filter((row) => row[key] !== id)
    },
  }
  const dependencies = {
    react: {useSyncExternalStore() {}},
    './chat': {flush: async () => {}},
    './componentData': {flush: async () => {}, dropPendingData() {}},
    './db': {db, openDb: async () => state.dbUnavailable ? null : {}},
    './rss': {proxied: (url) => url},
  }
  const module = {exports: {}}
  new Function('module', 'exports', 'require', 'localStorage', 'fetch', 'Date', 'crypto', js)(
    module, module.exports, (id) => dependencies[id], storage, fetch, {now: () => state.now}, webcrypto,
  )
  const config = {
    ...module.exports.defaultSyncConfig(),
    backend: 'http', http: {url: 'https://sync.invalid/snapshot', token: '', proxy: ''}, auto: false,
  }
  module.exports.writeSyncConfig(config)
  return {api: module.exports, storage, state, config}
}

function memoryRemote(initial = null) {
  let text = initial
  const writes = []
  const reads = []
  const state = {onRead() {}}
  return {
    get text() { return text },
    set text(value) { text = value },
    writes, reads, state,
    fetch: async (url, options = {}) => {
      reads.push({url, method: options.method ?? 'GET', headers: options.headers})
      if (options.method === 'PUT') {
        text = String(options.body)
        writes.push(text)
        return new Response('', {status: 200})
      }
      state.onRead()
      return text === null ? new Response('', {status: 404}) : new Response(text, {status: 200})
    },
  }
}

async function decrypt(text, passphrase) {
  const file = JSON.parse(text)
  const bytes = (value) => Uint8Array.from(Buffer.from(value, 'base64'))
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  const key = await webcrypto.subtle.deriveKey(
    {name: 'PBKDF2', salt: bytes(file.salt), iterations: 150000, hash: 'SHA-256'},
    base, {name: 'AES-GCM', length: 256}, false, ['decrypt'],
  )
  const plain = await webcrypto.subtle.decrypt({name: 'AES-GCM', iv: bytes(file.iv)}, key, bytes(file.data))
  return JSON.parse(new TextDecoder().decode(plain))
}

let count = 0
async function observe(name, run) {
  await run()
  count += 1
  console.log('现状已复现：' + name)
}

await observe('无变化仍全量 GET；只改一项仍上传所有记录', async () => {
  const remote = memoryRemote()
  const h = harness({fetch: remote.fetch, initial: {'fp.a': {v: 1}, 'fp.b': {v: 2}}})
  await h.api.runSync('push')
  await h.api.runSync('push')
  assert.equal(remote.writes.length, 1)
  assert.equal(remote.reads.filter((call) => call.method === 'GET').length, 2)
  h.state.now = 2000
  h.storage.setItem('fp.a', JSON.stringify({v: 3}))
  await h.api.runSync('push')
  assert.deepEqual(Object.keys(JSON.parse(remote.writes.at(-1)).recs).sort(), ['ls:fp.a', 'ls:fp.b'])
})

await observe('仅新增加密口令不会重写已有明文快照', async () => {
  const remote = memoryRemote()
  const h = harness({fetch: remote.fetch, initial: {'fp.a': {v: 1}}})
  await h.api.runSync()
  h.api.writeSyncConfig({...h.config, passphrase: 'test-pass'})
  await h.api.runSync()
  assert.equal(remote.writes.length, 1)
  assert.equal(JSON.parse(remote.text).enc, undefined)
})

await observe('关闭同步密钥后，后续上传仍带回远端已有密钥', async () => {
  const remote = memoryRemote()
  const h = harness({fetch: remote.fetch, initial: {'fp.a': {apiKey: 'fixture-secret', v: 1}, 'fp.b': {v: 1}}})
  h.api.writeSyncConfig({...h.config, secrets: true, passphrase: 'test-pass'})
  await h.api.runSync()
  h.api.writeSyncConfig({...h.config, secrets: false, passphrase: 'test-pass'})
  h.state.now = 2000
  h.storage.setItem('fp.b', JSON.stringify({v: 2}))
  await h.api.runSync()
  const plain = await decrypt(remote.text, 'test-pass')
  assert.equal(plain.recs['ls:fp.a'].v.apiKey, 'fixture-secret')
})

await observe('Gist 并发两端均成功，最后写入却覆盖另一端新增记录', async () => {
  let remote = JSON.stringify({app: 'dada', v: 1, recs: {}})
  let reads = 0
  let release
  const barrier = new Promise((resolve) => { release = resolve })
  const calls = []
  const fetch = async (_url, options = {}) => {
    calls.push(options)
    if (options.method === 'PATCH') {
      remote = JSON.parse(options.body).files['dada-sync.json'].content
      return new Response('{}', {status: 200})
    }
    const snapshot = remote
    reads += 1
    if (reads === 2) release()
    await barrier
    return new Response(JSON.stringify({files: {'dada-sync.json': {content: snapshot}}}), {status: 200})
  }
  const a = harness({fetch, initial: {'fp.a': 1}})
  const b = harness({fetch, initial: {'fp.b': 1}})
  for (const h of [a, b]) h.api.writeSyncConfig({...h.config, backend: 'gist', gist: {id: 'fixture', token: 'fixture'}})
  const results = await Promise.all([a.api.runSync('push'), b.api.runSync('push')])
  assert.deepEqual(results.map((result) => result.pushed), [1, 1])
  assert.equal(Object.keys(JSON.parse(remote).recs).length, 1)
  assert(calls.filter((call) => call.method === 'PATCH').every((call) => !call.headers['if-match']))
})

await observe('IDB 读取回落空集合会把已知聊天记录变为删除墓碑', async () => {
  const remote = memoryRemote()
  const h = harness({fetch: remote.fetch, stores: {kv: [], convs: [{id: 'c1'}], turns: [{id: 't1', convId: 'c1', endedAt: 1}]}})
  await h.api.runSync()
  h.state.now = 2000
  h.state.dbUnavailable = true
  await h.api.runSync()
  const recs = JSON.parse(remote.text).recs
  assert.equal(recs['conv:c1'].d, 1)
  assert.equal(recs['turn:t1'].d, 1)
})

await observe('fp.data 回落存储被排除，但 App 和 Applet 本地记录会上传', async () => {
  const remote = memoryRemote()
  const h = harness({fetch: remote.fetch, dbUnavailable: true, initial: {
    'fp.data.note': {text: 'note'}, 'fp.app.a': {count: 1}, 'fp.applet.b': {count: 2},
  }})
  await h.api.runSync()
  const keys = Object.keys(JSON.parse(remote.text).recs)
  assert(!keys.includes('ls:fp.data.note'))
  assert(keys.includes('ls:fp.app.a'))
  assert(keys.includes('ls:fp.applet.b'))
})

await observe('未知协议版本缺失 recs 会被当成空云端覆盖', async () => {
  const remote = memoryRemote(JSON.stringify({app: 'dada', v: 999, payload: {future: true}}))
  const h = harness({fetch: remote.fetch, initial: {'fp.a': 1}})
  await h.api.runSync()
  assert.equal(JSON.parse(remote.text).v, 1)
  assert.equal(JSON.parse(remote.text).payload, undefined)
})

await observe('Gist raw 响应 500 未校验，若 body 形状合法仍报告连接成功', async () => {
  let calls = 0
  const h = harness({fetch: async () => ++calls === 1
    ? new Response(JSON.stringify({files: {'dada-sync.json': {truncated: true, raw_url: 'https://raw.invalid/file'}}}), {status: 200})
    : new Response(JSON.stringify({app: 'dada', v: 1, recs: {}}), {status: 500}),
  })
  const message = await h.api.testConnection({...h.config, backend: 'gist', gist: {id: 'fixture', token: 'fixture'}})
  assert.match(message, /连接成功/)
})

await observe('同一非零毫秒的不同值保持分歧，却返回已是最新', async () => {
  const remote = memoryRemote()
  const h = harness({fetch: remote.fetch, initial: {'fp.a': 1}})
  await h.api.runSync()
  const cloud = JSON.parse(remote.text)
  cloud.recs['ls:fp.a'] = {t: 2000, h: 'remote-hash', v: 3}
  remote.text = JSON.stringify(cloud)
  h.state.now = 2000
  h.storage.setItem('fp.a', '2')
  assert.deepEqual(await h.api.runSync(), {pulled: 0, pushed: 0})
  assert.equal(h.storage.getItem('fp.a'), '2')
  assert.equal(JSON.parse(remote.text).recs['ls:fp.a'].v, 3)
})

await observe('GET 期间发生本地写入，full 入站没有版本保护会覆盖它', async () => {
  const remote = memoryRemote()
  const h = harness({fetch: remote.fetch, initial: {'fp.a': 1}})
  await h.api.runSync()
  const cloud = JSON.parse(remote.text)
  cloud.recs['ls:fp.a'] = {t: 3000, h: 'remote-next', v: 5}
  remote.text = JSON.stringify(cloud)
  h.state.now = 2500
  remote.state.onRead = () => h.storage.setItem('fp.a', '4')
  await h.api.runSync()
  assert.equal(h.storage.getItem('fp.a'), '5')
})

await observe('90 天墓碑清理后，长期离线旧副本会复活已删除记录', async () => {
  const remote = memoryRemote()
  const live = harness({fetch: remote.fetch, initial: {'fp.a': 1}})
  await live.api.runSync()
  const stale = harness({fetch: remote.fetch, initial: {'fp.a': 1}})
  await stale.api.runSync()
  live.state.now = 2000
  live.storage.removeItem('fp.a')
  await live.api.runSync()
  assert.equal(JSON.parse(remote.text).recs['ls:fp.a'].d, 1)
  live.state.now = 92 * 86400000
  live.storage.setItem('fp.b', '1')
  await live.api.runSync()
  assert.equal(JSON.parse(remote.text).recs['ls:fp.a'], undefined)
  stale.state.now = live.state.now + 1
  await stale.api.runSync()
  assert.equal(JSON.parse(remote.text).recs['ls:fp.a'].v, 1)
})

console.log('共 ' + count + ' 项现状观测完成；不是产品验收通过，全部外部依赖为内存替身。')
