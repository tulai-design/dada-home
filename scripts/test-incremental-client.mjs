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
  if (path === '/v1/pairings') return json({protocolVersion: 1, deviceId: calls.at(-1).body.deviceId, pairingToken: PAIR, expiresAt: calls.at(-1).body.expiresAt})
  if (path === '/v1/pairings/redeem') return json({protocolVersion: 1, device: {id: 'phone-1', scopes: [{appId: 'dada', spaceId: 'personal'}], expiresAt: null, revokedAt: null, kind: 'paired'}})
  return new Response('{}', {status: 404})
}

const modules = new Map()
function load(path) {
  if (modules.has(path)) return modules.get(path)
  const module = {exports: {}}; modules.set(path, module.exports)
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = id => {
    if (id === '@tulai-design/sync-sdk') return sdk
    if (id === '@tulai-design/sync-sdk/crypto') return encryption
    if (id === 'react') return {useSyncExternalStore: () => undefined}
    if (id === './incrementalSync') return {createIncrementalSyncController: () => { throw new Error('unused') }}
    if (id === './incrementalStore') return {incrementalStore: {}}
    if (id === './incrementalRows') return {SYNC_COLLECTIONS: ['config', 'component', 'applicationData', 'conversation', 'turn']}
    throw new Error('Unknown test import ' + id)
  }
  vm.runInThisContext('(function(module, exports, require) {' + code + '\n})', {filename: path})(module, module.exports, require)
  return module.exports
}
globalThis.crypto ??= (await import('node:crypto')).webcrypto
const client = load('src/lib/incrementalClient.ts')
const ADMIN = 'a'.repeat(48)
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
  admin.keyring = client.createSpaceKeyring(admin)
  const text = await client.createInvite('correct horse', 'phone-1', 24, admin)
  assert.equal(calls.at(-1).body.scopes[0].spaceId, 'personal')
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
  config.keyring = client.createSpaceKeyring(config)
  await assert.rejects(client.createInvite('short', 'phone-1', 24, config), /8 个字符/)
  await assert.rejects(client.createInvite('long enough pass', 'bad id!', 24, config), /设备标识/)
  await assert.rejects(client.acceptInvite('{"format":"x"}', 'whatever pass'), /不是搭搭/)
})

console.log(`共 ${passed} 项通过`)
