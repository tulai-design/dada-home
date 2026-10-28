import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as sdk from '@tulai-design/sync-sdk'
import * as encryption from '@tulai-design/sync-sdk/crypto'

const store = new Map()
globalThis.localStorage = {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key)}
const PAIR = 'p'.repeat(48)
const calls = []
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname
  calls.push({path, body: init?.body ? JSON.parse(init.body) : undefined})
  const json = body => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}})
  if (path === '/v1/pairings') return json({protocolVersion: 1, deviceId: calls.at(-1).body.deviceId, pairingToken: PAIR, expiresAt: Date.now() + 600_000})
  if (path === '/v1/pairings/redeem') return json({protocolVersion: 1, device: {id: 'phone-1', scopes: [{appId: 'dada', spaceId: 'personal'}], expiresAt: null, revokedAt: null, kind: 'paired'}})
  return new Response('{}', {status: 404})
}

let controllerFactory = () => {throw new Error('unused')}
let persistenceErrors = []
const modules = new Map()
function load(path) {
  if (modules.has(path)) return modules.get(path)
  const module = {exports: {}}; modules.set(path, module.exports)
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = id => {
    if (id === '@tulai-design/sync-sdk') return sdk
    if (id === '@tulai-design/sync-sdk/crypto') return encryption
    if (id === 'react') return {useSyncExternalStore: (_subscribe, snapshot) => snapshot()}
    if (id === './incrementalSync') return {createIncrementalSyncController: options => controllerFactory(options)}
    if (id === './incrementalStore') return {incrementalStore: {}}
    if (id === './persistence') return {getPersistenceStatus: () => ({errors: persistenceErrors})}
    if (id === './incrementalRows') return {SYNC_COLLECTIONS: ['config', 'component', 'applicationData', 'conversation', 'turn']}
    throw new Error('Unknown test import ' + id)
  }
  vm.runInThisContext('(function(module, exports, require) {' + code + '\n})', {filename: path})(module, module.exports, require)
  return module.exports
}
globalThis.crypto ??= (await import('node:crypto')).webcrypto
const client = load('src/lib/incrementalClient.ts')
const ADMIN = 'a'.repeat(48)
// 测试用：空库才允许新建密钥，所以先让模拟服务返回空日志。
async function keyringFor(config) {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({protocolVersion: 1, commits: [], cursor: 'c', hasMore: false}), {status: 200, headers: {'content-type': 'application/json'}})
  try {return await client.createSpaceKeyring(config)} finally {globalThis.fetch = original}
}
let passed = 0
async function test(name, work) {await work(); passed++; console.log('通过：' + name)}

await test('默认配置未就绪，并给出下一步提示', () => {
  const config = client.readIncrementalConfig()
  assert.match(client.incrementalConfigProblem(config), /服务地址/)
  assert.equal(client.incrementalConfigured(config), false)
  assert.match(client.incrementalConfigProblem({...config, endpoint: 'http://sync.example.com', token: ADMIN}), /https/)
  assert.match(client.incrementalConfigProblem({...config, endpoint: 'https://sync.example.com', token: ADMIN}), /密钥/)
})

await test('邀请往返：口令正确才兑换，新设备生成自己的令牌与密钥', async () => {
  const admin = {...client.readIncrementalConfig(), endpoint: 'https://sync.example.com', token: ADMIN}
  admin.keyring = await keyringFor(admin)
  const text = await client.createInvite('correct horse', 'phone-1', null, admin)
  assert.equal(calls.at(-1).body.scopes[0].spaceId, 'personal')
  assert.equal(calls.at(-1).body.expiresAt, null, '默认长期有效，不能带期限')
  assert.ok(!text.includes(admin.keyring.keys[0].key), '邀请不能包含明文密钥')
  const before = calls.length
  await assert.rejects(client.acceptInvite(text, 'wrong passphrase'))
  assert.equal(calls.length, before, '口令错误不能兑换配对码')
  const joined = await client.acceptInvite(text, 'correct horse')
  assert.equal(calls.at(-1).body.pairingToken, PAIR)
  assert.equal(joined.deviceId, 'phone-1')
  assert.notEqual(joined.token, ADMIN)
  assert.equal(joined.token, calls.at(-1).body.token)
  assert.deepEqual(joined.keyring.keys, admin.keyring.keys)
  assert.equal(client.readIncrementalConfig().token, joined.token)
})

await test('邀请参数校验', async () => {
  const config = {...client.readIncrementalConfig(), endpoint: 'https://sync.example.com', token: ADMIN}
  config.keyring = await keyringFor(config)
  await assert.rejects(client.createInvite('short', 'phone-1', null, config), /8 个字符/)
  await assert.rejects(client.createInvite('long enough pass', 'bad id!', null, config), /设备标识/)
  await assert.rejects(client.createInvite('long enough pass', 'phone-2', Date.now() - 1000, config), /到期时间/)
  await assert.rejects(client.createInvite('long enough pass', 'phone-2', Date.now() + 400 * 86_400_000, config), /最长一年/)
  await assert.rejects(client.acceptInvite('{"format":"x"}', 'whatever pass'), /不是搭搭/)
})

await test('服务器已有数据或无法确认时拒绝新建密钥，空库才允许', async () => {
  const config = {...client.readIncrementalConfig(), endpoint: 'https://sync.example.com', token: ADMIN}
  const page = commits => new Response(JSON.stringify({protocolVersion: 1, commits, cursor: 'c', hasMore: false}), {status: 200, headers: {'content-type': 'application/json'}})
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => page([])
    assert.equal((await client.createSpaceKeyring(config)).format, 'tulai-keyring')
    globalThis.fetch = async () => new Response('{}', {status: 500})
    await assert.rejects(client.createSpaceKeyring(config), /无法确认/)
  } finally {globalThis.fetch = original}
})

await test('手动同步先排空上传，再用单轮批量拉取，第二次无修改同步为空操作', async () => {
  const calls = []
  let uploadRounds = 0, pulls = 0, closed = 0
  controllerFactory = () => ({
    async run(options) {
      calls.push(options)
      if (options.pull === false) {uploadRounds++; return {pushed: uploadRounds <= 2 ? 100 : 0, pulled: 0, conflicts: 0, hasMore: uploadRounds < 2, needsReload: false}}
      pulls++; return {pushed: 0, pulled: pulls === 1 ? 61 : 0, conflicts: 0, hasMore: false, needsReload: false}
    },
    async inspect() {return {records: []}},
    close() {closed++},
  })
  const first = await client.runIncremental()
  assert.equal(first.phase, 'ok'); assert.equal(first.pushed, 200); assert.equal(first.pulled, 61)
  assert.deepEqual(calls.map(options => options.pull === false), [true, true, false])
  assert.equal(calls.at(-1).maxPull, 10000)
  const second = await client.runIncremental()
  assert.equal(second.phase, 'ok'); assert.equal(second.pushed, 0); assert.equal(second.pulled, 0)
  assert.equal(closed, 2)
})

await test('上传或下载预算耗尽显示未完成，不宣称同步成功', async () => {
  for (const uploadOnly of [true, false]) {
    let calls = 0
    controllerFactory = () => ({
      async run(options) {calls++; return {pushed: 0, pulled: 0, conflicts: 0, hasMore: uploadOnly || options.pull !== false, needsReload: !uploadOnly && options.pull !== false}},
      async inspect() {return {records: []}}, close() {},
    })
    const result = await client.runIncremental()
    assert.equal(result.phase, 'error'); assert.equal(result.hasMore, true)
    assert.match(result.message, /尚未完成/)
    assert.equal(result.needsReload, !uploadOnly)
    assert.equal(calls, uploadOnly ? 100 : 2)
  }
})

await test('部分入站后失败以及再次同步失败，都保留需要重载的状态', async () => {
  persistenceErrors = []
  controllerFactory = () => ({
    async run(options) {
      if (persistenceErrors.length) throw new Error('reload required')
      if (options.pull === false) return {pushed: 0, pulled: 0, conflicts: 0, hasMore: false, needsReload: false}
      persistenceErrors = [{source: 'sync-reload'}]
      throw new Error('network interrupted after apply')
    },
    async inspect() {return {records: []}}, close() {},
  })
  const result = await client.runIncremental()
  assert.equal(result.phase, 'error'); assert.equal(result.needsReload, true)
  assert.match(result.message, /network interrupted/)
  const again = await client.runIncremental({pull: false})
  assert.equal(again.needsReload, true); assert.match(again.message, /reload/)
  persistenceErrors = []
})

await test('解决冲突提交后落盘失败也向设置页保留重新加载入口', async () => {
  persistenceErrors = []
  controllerFactory = () => ({
    async resolve() {persistenceErrors = [{source: 'sync-reload'}]; throw new Error('localStorage full')}, close() {},
  })
  await assert.rejects(client.resolveConflict({ref: {collection: 'config', key: 'search'}, version: {localGeneration: 1, remoteRevision: 2}}, 'remote'), /localStorage full/)
  assert.equal(client.useIncrementalStatus().needsReload, true)
  persistenceErrors = []
})

console.log(`共 ${passed} 项通过`)
