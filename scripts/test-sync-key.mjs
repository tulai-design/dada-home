import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/syncKey.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
const module = {exports: {}}
new Function('module', 'exports', source)(module, module.exports)
const {parseSyncKey, encodeSyncKey, syncKeyFromLegacyConfig} = module.exports

const material = {
  endpoint: 'https://sync.example.com',
  appId: 'dada',
  spaceId: 'personal',
  deviceId: 's0123456789abcdef',
  token: 'a'.repeat(43),
  keyring: {format: 'tulai-keyring', version: 1, appId: 'dada', spaceId: 'personal', activeKeyId: 'k_abc', keys: [{id: 'k_abc', key: 'k'.repeat(43)}]},
}

test('同步密钥可以往返，服务地址去掉末尾斜杠', () => {
  const key = encodeSyncKey({...material, endpoint: 'https://sync.example.com/'})
  assert.equal(key.startsWith('tulai1.'), true)
  assert.deepEqual(parseSyncKey(key), {...material, endpoint: 'https://sync.example.com'})
  assert.equal(parseSyncKey(`  ${key}  `).appId, 'dada')
})

test('旧设置里对得上的空间密钥可以重新包成同步密钥', () => {
  const legacy = {endpoint: 'https://sync.example.com', appId: 'dada', spaceId: 'personal', deviceId: 'web-abcdef012345', token: 'b'.repeat(43), keyring: material.keyring}
  const key = syncKeyFromLegacyConfig(legacy, 'k_abc', {appId: 'dada', spaceId: 'personal'})
  assert.equal(parseSyncKey(key).deviceId, 'web-abcdef012345')
  assert.equal(syncKeyFromLegacyConfig(legacy, 'k_other', {appId: 'dada', spaceId: 'personal'}), null)
  assert.equal(syncKeyFromLegacyConfig(legacy, 'k_abc', {appId: 'momoki', spaceId: 'personal'}), null)
})

test('拒绝普通口令、错误版本和非 https 地址', () => {
  assert.throws(() => parseSyncKey('not-a-key'), /管理页/)
  const encoded = encodeSyncKey(material)
  const broken = encoded.slice(0, 'tulai1.'.length) + 'AAAA'
  assert.throws(() => parseSyncKey(broken), /无法读取/)
  const payload = JSON.parse(Buffer.from(encoded.slice('tulai1.'.length).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())
  payload.v = 2
  const next = 'tulai1.' + Buffer.from(JSON.stringify(payload)).toString('base64url')
  assert.throws(() => parseSyncKey(next), /版本/)
  payload.v = 1
  payload.endpoint = 'http://sync.example.com'
  const remote = 'tulai1.' + Buffer.from(JSON.stringify(payload)).toString('base64url')
  assert.throws(() => parseSyncKey(remote), /https/)
})
