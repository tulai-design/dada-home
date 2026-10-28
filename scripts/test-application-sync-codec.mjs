import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as sdk from '@tulai-design/sync-sdk'
import * as encryption from '@tulai-design/sync-sdk/crypto'

const modules = new Map()
function load(path) {
  if (modules.has(path)) return modules.get(path)
  const module = {exports: {}}; modules.set(path, module.exports)
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = id => {
    if (id === '@tulai-design/sync-sdk') return sdk
    if (id === '@tulai-design/sync-sdk/crypto') return encryption
    if (id.startsWith('.')) return load(new URL(id + '.ts', 'file:///' + path).pathname.slice(1))
    throw new Error('Unknown test import')
  }
  vm.runInThisContext('(function(module, exports, require) {' + code + '\n})', {filename: path})(module, module.exports, require)
  return module.exports
}
const codec = load('src/lib/incrementalCodec.ts'), projection = load('src/lib/applicationSyncProjection.ts'), schema = load('src/lib/applicationDataSchema.ts')
const scope = {appId: 'dada', spaceId: 'personal'}, keyring = encryption.createKeyring(scope)
const options = {scope, keyring}
const entityId = key => codec.entityIdFor({collection: 'applicationData', key})
const clean = value => JSON.parse(JSON.stringify(value))
let passed = 0
async function test(name, work) {await work(); passed++; console.log('通过：' + name)}
async function prepare(key, value) {return codec.prepareSyncRecord({ref: {collection: 'applicationData', key}, value, operationId: 'operation', baseRevision: null}, options)}
function record(prepared) {const {type: _type, baseRevision: _base, ...mutation} = prepared.request.mutations[0]; return {...mutation, revision: 1, deleted: false}}
function clientFor(prepared, before) {
  return {async downloadObject(descriptor, sink) {
    before?.(descriptor)
    const bytes = new Uint8Array(await prepared.ciphertext.arrayBuffer())
    for (let offset = 0; offset < bytes.length; offset += 1048576) await sink.write(offset, bytes.subarray(offset, offset + 1048576))
    await sink.commit(); return descriptor
  }}
}

await test('凭据投影递归过滤且不改源，远端秘密不注入，数组只按唯一ID恢复', async () => {
  const local = {token: 'local', nested: {apiKey: 'local-key', text: 'kept'}, rows: [{id: 'a', token: 'a-secret'}, {id: 'b', token: 'b-secret'}], ambiguous: [{id: 'same', password: 'first'}, {id: 'same', password: 'second'}]}
  const projected = projection.projectApplicationData(local)
  assert.deepEqual(clean(projected), {nested: {text: 'kept'}, rows: [{id: 'a'}, {id: 'b'}], ambiguous: [{id: 'same'}, {id: 'same'}]})
  assert.equal(local.token, 'local')
  const restored = projection.restoreApplicationData({token: 'remote', secret: 'must-not-enter', nested: {apiKey: 'remote-key', text: 'new'}, rows: [{id: 'b'}, {id: 'a'}, {id: 'c', token: 'remote'}], ambiguous: [{id: 'same'}]}, local)
  assert.equal(restored.token, 'local'); assert.equal(restored.secret, undefined); assert.equal(restored.nested.apiKey, 'local-key')
  assert.deepEqual(clean(restored.rows), [{id: 'b', token: 'b-secret'}, {id: 'a', token: 'a-secret'}, {id: 'c'}])
  assert.deepEqual(clean(restored.ambiguous), [{id: 'same'}])
  assert.deepEqual(clean(projection.restoreApplicationData({rows: [{id: 'a'}, {id: 'a'}]}, local).rows), [{id: 'a'}, {id: 'a'}])
  const dangerous = JSON.parse('{"__proto__":{"token":"local","safe":true}}')
  const safe = projection.restoreApplicationData(JSON.parse('{"__proto__":{"safe":false}}'), dangerous)
  assert.equal(safe.__proto__.token, 'local'); assert.equal({}.token, undefined)
})

await test('入站恢复本机凭据后重新校验8MiB，不能保存超限合并结果', async () => {
  const portable = {text: 'a'.repeat(schema.APPLICATION_DATA_MAX_BYTES - 11)}
  assert.equal(new TextEncoder().encode(JSON.stringify(portable)).length, schema.APPLICATION_DATA_MAX_BYTES)
  assert.throws(() => projection.restoreApplicationData(portable, {token: 'local'}), /8 MiB/)
})

await test('哈希身份保留App/Applet隔离、1000字符及孤立surrogate，不发生UTF8替换碰撞', async () => {
  const a = await entityId('app:same'), b = await entityId('applet:same')
  assert.notEqual(a, b); assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(await entityId('app:\ud800'), await entityId('app:\ufffd'))
  assert.match(await entityId('app:' + '中'.repeat(996)), /^[0-9a-f]{64}$/)
  await assert.rejects(entityId('app:' + '中'.repeat(997)))
})

await test('8MiB完整应用状态经加密对象恢复，wire payload保持很小且凭据不出站', async () => {
  const value = {text: 'a'.repeat(schema.APPLICATION_DATA_MAX_BYTES - 11)}
  const prepared = await prepare('app:large', value), wire = record(prepared)
  assert.equal(prepared.ciphertext.size, schema.APPLICATION_DATA_MAX_BYTES + 9 * 16)
  assert.ok(JSON.stringify(wire.payload).length < 4096)
  const incoming = await codec.decodeSyncRecord(wire, {...options, client: clientFor(prepared)})
  assert.equal(incoming.value.text, value.text)
  const secret = await prepare('app:secrets', {token: 'local-only', values: [{id: 'x', password: 'password', data: 'text'}]})
  const restored = await codec.decodeSyncRecord(record(secret), {...options, client: clientFor(secret)})
  assert.deepEqual(clean(restored.value), {values: [{id: 'x', data: 'text'}]})
})

await test('100层对象不经过服务payload深度限制，空对象与逻辑删除分别表达', async () => {
  let value = 'leaf'; for (let i = 0; i < 100; i++) value = {x: value}
  const prepared = await prepare('applet:deep', value)
  const restored = await codec.decodeSyncRecord(record(prepared), {...options, client: clientFor(prepared)})
  assert.equal(JSON.stringify(restored.value), JSON.stringify(value))
  const empty = await prepare('app:empty', {}), deleted = await prepare('app:empty', null)
  assert.ok(empty.ciphertext); assert.equal(deleted.ciphertext, undefined)
  assert.equal(deleted.request.mutations[0].type, 'put'); assert.equal(deleted.request.mutations[0].objectRefs, undefined)
  assert.deepEqual(clean((await codec.decodeSyncRecord(record(empty), {...options, client: clientFor(empty)})).value), {})
  assert.equal((await codec.decodeSyncRecord(record(deleted), {...options, client: {downloadObject() {assert.fail('墓碑不能读取对象')}}})).value, null)
})

await test('错key、错身份、未知collection/schema、裸服务删除、对象引用篡改均明确失败', async () => {
  const prepared = await prepare('app:source', {text: 'value'}), wire = record(prepared), client = clientFor(prepared)
  for (const mutation of [{...wire, collection: 'other'}, {...wire, schemaVersion: 2}, {...wire, deleted: true}, {...wire, entityId: await entityId('app:other')}, {...wire, objectRefs: []}, {...wire, objectRefs: [{...wire.objectRefs[0], byteLength: wire.objectRefs[0].byteLength + 1}]}]) await assert.rejects(codec.decodeSyncRecord(mutation, {...options, client}))
  await assert.rejects(codec.decodeSyncRecord(wire, {...options, keyring: encryption.createKeyring(scope), client}))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(codec.decodeSyncRecord(wire, {...options, client, signal: controller.signal}), e => e.name === 'AbortError')
})

console.log(`应用同步codec通过：${passed}项`)
