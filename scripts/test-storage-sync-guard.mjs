import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// 真实公开 runSync；合成配置和隔离网络，确保本地故障不会转成云端删除。
function harness({all = async () => [], flush = async () => {}, flushApps = async () => {}, fetch = async () => new Response('', {status: 404})} = {}) {
  const rows = new Map()
  const storage = {
    get length() {return rows.size}, key: index => [...rows.keys()][index] ?? null,
    getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, String(value)),
    removeItem: key => rows.delete(key),
  }
  const modules = new Map()
  let requests = 0
  const dependencies = {
    react: {useSyncExternalStore: (_, get) => get()},
    './applicationData': {flushApplicationData: flushApps},
    './chat': {flush}, './componentData': {flush, dropPendingData() {}},
    './db': {db: {all, snapshot: async () => ({kv: await all('kv'), apps: await all('apps'), convs: await all('convs'), turns: await all('turns'), toolDetails: await all('toolDetails')})}, openDb: async () => ({})}, './rss': {proxied: url => url},
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const module = {exports: {}}
    modules.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(new URL('../src/lib/' + file + '.ts', import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText
    const require = id => Object.hasOwn(dependencies, id) ? dependencies[id] : load(id.slice(2))
    new Function('module', 'exports', 'require', 'localStorage', 'fetch', code)(module, module.exports, require, storage, (...args) => {requests++;return fetch(...args)})
    return module.exports
  }
  const sync = load('sync')
  sync.writeSyncConfig({...sync.defaultSyncConfig(), backend: 'http', auto: false, http: {url: 'https://sync.invalid/test', token: '', proxy: ''}})
  return {sync, persistence: load('persistence'), storage, get requests() {return requests}}
}

let passed = 0
async function test(name, run) {await run();passed++;console.log('通过：' + name)}
await test('数据库读取失败不生成删除、不改meta、不请求远端', async () => {
  const h = harness({all: async () => {throw new Error('模拟事务读取失败')}})
  const meta = JSON.stringify({mode: 0, recs: {'turn:existing': {h: 'old', t: 1}}})
  h.storage.setItem('fp.sync.meta.v2', meta)
  await assert.rejects(h.sync.runSync(), /读取失败/)
  assert.equal(h.requests, 0)
  assert.equal(h.storage.getItem('fp.sync.meta.v2'), meta)
})
await test('待写失败中止同步，避免内存与磁盘不一致被上传', async () => {
  const h = harness({flush: async () => {throw new Error('模拟保存未完成')}})
  await assert.rejects(h.sync.runSync(), /保存未完成/)
  assert.equal(h.requests, 0)
})
await test('应用保存未确认时同步零网络，不制造远端删除', async () => {
  const h = harness({flushApps: async () => {throw new Error('应用事务未提交')}})
  await assert.rejects(h.sync.runSync(), /应用事务未提交/)
  assert.equal(h.requests, 0)
})
await test('配置重试仍失败时不对外同步，恢复门禁期间也拒绝同步', async () => {
  const h = harness()
  h.persistence.reportPersistenceError('settings', new Error('quota'), async () => {throw new Error('quota')})
  await assert.rejects(h.sync.runSync(), /quota/)
  assert.equal(h.requests, 0)
  h.persistence.clearPersistenceError('settings')
  await h.persistence.withPersistenceExclusive(async () => {
    await assert.rejects(h.sync.runSync(), /恢复|导出/)
  })
  assert.equal(h.requests, 0)
})
await test('恢复可以等待正在进行的同步结束', async () => {
  let release
  const response = new Promise(resolve => {release = resolve})
  const h = harness({fetch: async () => response})
  const running = h.sync.runSync()
  while (!h.requests) await new Promise(resolve => setImmediate(resolve))
  let idle = false
  const waiting = h.sync.waitForSyncIdle().then(() => {idle = true})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(idle, false)
  release(new Response('', {status: 503}))
  await assert.rejects(running)
  await waiting
  assert.equal(idle, true)
})
console.log(`存储与同步故障隔离：${passed}/${passed}`)
