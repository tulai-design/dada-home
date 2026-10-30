import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {webcrypto, randomUUID} from 'node:crypto'
import ts from 'typescript'
import path from 'node:path'

// 测真实状态机；数据库替身只供状态转换单测，真实IDB事务另由浏览器QA验收。
function runtime() {
  const tables = {kv: new Map(), apps: new Map(), convs: new Map(), turns: new Map(), toolDetails: new Map(), incrementalSync: new Map()}, modules = new Map(), readsLog = []
  const db = {
    async get(store, key) {return structuredClone(tables[store].get(key))},
    async batch(operations) {return this.atomic([], [], () => ({operations, result: undefined}))},
    async atomic(_stores, reads, decide) {
      readsLog.push(structuredClone(reads))
      const values = reads.map(read => read.all ? [...tables[read.store].values()].filter(row => !read.index || row[read.index] === read.key) : tables[read.store].get(read.key))
      const plan = decide(structuredClone(values)), next = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, new Map(rows)]))
      for (const operation of plan.operations) {
        if (operation.type === 'clear') next[operation.store].clear()
        else if (operation.type === 'delete') next[operation.store].delete(operation.key)
        else next[operation.store].set(operation.value.k ?? operation.value.id, structuredClone(operation.value))
      }
      Object.assign(tables, next)
      return structuredClone(plan.result)
    },
  }
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const module = {exports: {}}; modules.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(new URL('../src/lib/' + file + '.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
    vm.runInNewContext(code, {module, exports: module.exports, require: id => {if (id === './db') return {db}; assert.ok(id.startsWith('.'), `未隔离依赖：${id}`); return load(path.posix.normalize(path.posix.join(path.posix.dirname(file), id)))}, structuredClone, TextEncoder, URL, Blob, crypto: {...webcrypto, randomUUID}}, {filename: file})
    return module.exports
  }
  const engine = load('incrementalStore').incrementalStore, local = load('applicationSyncStore').applicationSyncStore
  return {store: wrap(engine, local), engine, commitWithSync: load('incrementalLocal').commitWithSync, tables, readsLog}
}
// 测试门面：引擎按集合通用，这里按应用数据调用，并把 sample 值挂到意图上便于断言。
const refOf = key => ({collection: 'applicationData', key})
function wrap(engine, local) {
  return {
    ...local,
    active: () => engine.active(), bind: id => engine.bind(id), detach: e => engine.detach(e), inspect: e => engine.inspect(e),
    checkpoint: (...a) => engine.checkpoint(...a), acknowledge: (...a) => engine.acknowledge(...a),
    async next(epoch) {
      const head = await engine.next(epoch)
      return head && {...head.intent, applicationKey: head.ref.key, value: head.intent.prepared ? undefined : (await engine.sample(head.ref)).value}
    },
    prepare: (epoch, id, wire) => engine.prepare(epoch, id, wire, !wire.ciphertext),
    applyPage: (epoch, cursor, page) => engine.applyPage(epoch, cursor, {...page, records: page.records.map(({applicationKey, ...row}) => ({...row, ref: refOf(applicationKey)}))}),
    resolve: (epoch, key, ...a) => engine.resolve(epoch, refOf(key), ...a),
  }
}
const identity = {endpoint: 'http://127.0.0.1:8787', appId: 'dada', spaceId: 'personal', deviceId: 'desktop', keyFingerprint: 'a'.repeat(64)}
const clean = value => JSON.parse(JSON.stringify(value))
const key = 'app:tool'
function prepared(intent) {
  const ciphertext = intent.deleting ? undefined : new Blob([new Uint8Array(16)])
  const mutation = {type: 'put', collection: 'applicationData', entityId: 'b'.repeat(64), baseRevision: intent.baseRevision, schemaVersion: 1, payload: {format: 'tulai-encrypted', version: 1, keyId: 'k', iv: 'a', ciphertext: 'b'}}
  if (ciphertext) mutation.objectRefs = [{sha256: 'c'.repeat(64), byteLength: ciphertext.size}]
  return {request: {protocolVersion: 1, operationId: intent.operationId, mutations: [mutation]}, ...(ciphertext ? {ciphertext} : {})}
}
const receipt = (intent, revision) => ({protocolVersion: 1, status: 'committed', operationId: intent.operationId, revision, records: [{collection: 'applicationData', entityId: 'b'.repeat(64), revision, deleted: false}]})
const incoming = (value, revision, operationId = 'remote-' + revision) => ({applicationKey: key, entityId: 'b'.repeat(64), revision, value, deviceId: 'mobile', operationId})
let count = 0
async function test(name, run) {await run(); count++; console.log('通过：' + name)}

await test('纯本地保存无队列，bind种子不改变应用generation，完整业务数据进入draft', async () => {
  const {store, tables} = runtime()
  assert.equal(await store.saveLocal(key, {count: 1, token: 'local-secret'}, 0), 1)
  assert.equal((await store.inspect()).records.length, 0)
  const binding = await store.bind(identity)
  assert.equal((await store.loadLocal(key)).generation, 1)
  assert.deepEqual(clean((await store.next(binding.epoch)).value), {count: 1, token: 'local-secret'})
  assert.equal(tables.apps.get(key).v.token, 'local-secret')
  await assert.rejects(store.bind({...identity, spaceId: 'other'}), /不同.*绑定/)
})

await test('prepared在后继编辑后不变，ack只确认旧generation，新请求基于确认版本', async () => {
  const {store} = runtime(), binding = await store.bind(identity)
  await store.saveLocal(key, {count: 1}, 0)
  const intent = await store.next(binding.epoch), wire = prepared(intent)
  await store.prepare(binding.epoch, intent.operationId, wire)
  await store.saveLocal(key, {count: 2}, 1)
  const retry = await store.next(binding.epoch)
  assert.equal(retry.operationId, intent.operationId); assert.equal(retry.value, undefined) // 已 prepared：重试只用固定请求，不再读取本机当前值
  assert.deepEqual(clean(retry.prepared.request), wire.request)
  await store.acknowledge(binding.epoch, intent.operationId, receipt(intent, 7))
  assert.deepEqual(clean((await store.loadLocal(key)).value), {count: 2})
  const next = await store.next(binding.epoch)
  assert.notEqual(next.operationId, intent.operationId); assert.equal(next.baseRevision, 7); assert.equal(next.generation, 2)
  assert.deepEqual(clean(next.value), {count: 2})
})

await test('本机提交回流可对账丢回执，不把后续编辑覆盖或判为冲突', async () => {
  const {store} = runtime(), binding = await store.bind(identity)
  await store.saveLocal(key, {count: 1}, 0)
  const intent = await store.next(binding.epoch); await store.prepare(binding.epoch, intent.operationId, prepared(intent))
  await store.saveLocal(key, {count: 2}, 1)
  const applied = await store.applyPage(binding.epoch, undefined, {cursor: 'one', records: [{...incoming({count: 1}, 3, intent.operationId), deviceId: identity.deviceId}]})
  assert.equal(applied.changed, false); assert.equal(applied.conflicts, 0)
  assert.equal((await store.next(binding.epoch)).baseRevision, 3)
  assert.deepEqual(clean((await store.loadLocal(key)).value), {count: 2})
})

await test('冲突保存双方与游标，后来编辑使旧解决generation失效，明确保留本地才能重发', async () => {
  const {store} = runtime(), binding = await store.bind(identity)
  await store.saveLocal(key, {local: 1, apiKey: 'keep'}, 0)
  const result = await store.applyPage(binding.epoch, undefined, {cursor: 'one', records: [incoming({remote: 2}, 1)]})
  assert.equal(result.changed, false); assert.equal(result.conflicts, 1)
  assert.equal(await store.next(binding.epoch), undefined)
  let conflict = (await store.inspect()).records[0].conflict
  assert.deepEqual(clean(conflict.remoteValue), {remote: 2}); assert.equal(conflict.localValue, undefined) // 本地候选从活动数据实时读取，不在冲突里留副本
  await store.saveLocal(key, {local: 3, apiKey: 'keep'}, 1)
  await assert.rejects(store.resolve(binding.epoch, key, {localGeneration: 1, remoteRevision: 1}, 'remote'), /其他页面/)
  assert.equal((await store.resolve(binding.epoch, key, {localGeneration: 2, remoteRevision: 1}, 'local')).changed, true)
  const intent = await store.next(binding.epoch)
  assert.equal(intent.baseRevision, 1); assert.deepEqual(clean(intent.value), {local: 3, apiKey: 'keep'})
  assert.equal((await store.loadLocal(key)).value.apiKey, 'keep')
})

await test('无本地变更的入站应用和cursor同计划，错误页和旧cursor拒绝，删除不同于空对象', async () => {
  const {store} = runtime(), binding = await store.bind(identity)
  await store.applyPage(binding.epoch, undefined, {cursor: 'one', records: [incoming({}, 1)]})
  assert.deepEqual(clean((await store.loadLocal(key)).value), {})
  await assert.rejects(store.applyPage(binding.epoch, undefined, {cursor: 'bad', records: [incoming({bad: true}, 2)]}), /游标/)
  await assert.rejects(store.applyPage(binding.epoch, 'one', {cursor: 'bad', records: [incoming({ok: true}, 2), incoming([], 3)]}))
  assert.equal((await store.active()).cursor, 'one')
  assert.deepEqual(clean((await store.loadLocal(key)).value), {})
  await store.applyPage(binding.epoch, 'one', {cursor: 'two', records: [incoming(null, 2)]})
  assert.equal((await store.loadLocal(key)).value, null)
  assert.equal(await store.next(binding.epoch), undefined)
})

await test('删除draft不会被空值合并回旧live，409先保留候选等待远端内容', async () => {
  const {store} = runtime(), binding = await store.bind(identity)
  await store.saveLocal(key, {old: true}, 0)
  const intent = await store.next(binding.epoch); await store.prepare(binding.epoch, intent.operationId, prepared(intent))
  await store.saveLocal(key, null, 1)
  await store.acknowledge(binding.epoch, intent.operationId, {protocolVersion: 1, operationId: intent.operationId, status: 'conflict', conflicts: [{collection: 'applicationData', entityId: 'b'.repeat(64), baseRevision: null, currentRevision: 1}]})
  assert.equal((await store.inspect()).records[0].conflict.remoteReady, false)
  await assert.rejects(store.resolve(binding.epoch, key, {localGeneration: 2, remoteRevision: 1}, 'remote'), /尚未读取/)
  await store.applyPage(binding.epoch, undefined, {cursor: 'one', records: [incoming({remote: true}, 1)]})
  await store.resolve(binding.epoch, key, {localGeneration: 2, remoteRevision: 1}, 'local')
  assert.equal((await store.next(binding.epoch)).value, null)
})

await test('detach保留旧prepared与冲突，旧epoch结果拒绝，rebind新epoch重新seed', async () => {
  const {store} = runtime(), first = await store.bind(identity)
  await store.saveLocal(key, {count: 1}, 0)
  const intent = await store.next(first.epoch); await store.prepare(first.epoch, intent.operationId, prepared(intent))
  await store.detach(first.epoch)
  assert.equal(await store.active(), undefined)
  assert.equal((await store.inspect(first.epoch)).records[0].inFlight.operationId, intent.operationId)
  await assert.rejects(store.acknowledge(first.epoch, intent.operationId, receipt(intent, 1)), /绑定已改变/)
  await store.saveLocal(key, {count: 2}, 1)
  const second = await store.bind(identity)
  assert.notEqual(second.epoch, first.epoch)
  assert.equal((await store.next(second.epoch)).baseRevision, null)
  await assert.rejects(store.applyPage(first.epoch, undefined, {cursor: 'one', records: []}), /绑定已改变/)
})

await test('inspect只读目标epoch，当前状态不扫描解绑后保留的密文档案', async () => {
  const {store, readsLog} = runtime(), first = await store.bind(identity)
  await store.saveLocal(key, {count: 1}, 0)
  const intent = await store.next(first.epoch); await store.prepare(first.epoch, intent.operationId, prepared(intent))
  await store.detach(first.epoch)
  const second = await store.bind(identity)
  readsLog.length = 0
  const archived = await store.inspect(first.epoch), current = await store.inspect()
  assert.equal(archived.binding.epoch, first.epoch); assert.equal(archived.records[0].inFlight.operationId, intent.operationId)
  assert.equal(current.binding.epoch, second.epoch); assert.equal(current.records[0].inFlight, undefined)
  const bulk = readsLog.flat().filter(read => read.all)
  assert.deepEqual(bulk.map(read => [read.index, read.key]), [['epoch', first.epoch], ['epoch', second.epoch]])
})

await test('整包替换活动绑定时零写，解绑替换及回退都增加缓存generation但保留旧队列', async () => {
  const {store} = runtime()
  await store.saveLocal(key, {before: true}, 0)
  const binding = await store.bind(identity), intent = await store.next(binding.epoch)
  await store.prepare(binding.epoch, intent.operationId, prepared(intent))
  const replace = [{store: 'apps', type: 'clear'}, {store: 'apps', type: 'put', value: {k: key, v: {restored: true}}}]
  await assert.rejects(store.commitExternal(replace), /先显式解绑/)
  assert.equal((await store.loadLocal(key)).generation, 1)
  await store.detach(binding.epoch)
  await store.commitExternal(replace)
  assert.equal((await store.loadLocal(key)).generation, 2)
  await assert.rejects(store.saveLocal(key, {stale: true}, 1), /其他页面/)
  await store.commitExternal([{store: 'apps', type: 'put', value: {k: key, v: {before: true}}}])
  assert.equal((await store.loadLocal(key)).generation, 3)
  assert.equal((await store.inspect(binding.epoch)).records[0].inFlight.operationId, intent.operationId)
})

await test('冲突解决同时守卫本地和远端版本，看到旧remote的选择不能覆盖新remote', async () => {
  const {store} = runtime(), binding = await store.bind(identity)
  await store.saveLocal(key, {local: true}, 0)
  await store.applyPage(binding.epoch, undefined, {cursor: 'one', records: [incoming({remote: 1}, 1)]})
  const observed = (await store.inspect()).records[0].conflict
  await store.applyPage(binding.epoch, 'one', {cursor: 'two', records: [incoming({remote: 2}, 2)]})
  for (const choice of ['local', 'remote']) await assert.rejects(store.resolve(binding.epoch, key, {localGeneration: observed.localGeneration, remoteRevision: observed.remoteRevision}, choice), /远端冲突.*新版本/)
  assert.equal(await store.next(binding.epoch), undefined)
  assert.equal((await store.loadLocal(key)).generation, 1)
  await store.resolve(binding.epoch, key, {localGeneration: 1, remoteRevision: 2}, 'local')
  assert.equal((await store.next(binding.epoch)).baseRevision, 2)
})
const turn = (id = 't1', tools = 1) => ({id, convId: 'c1', prompt: 'hi', answer: 'ok', reasoning: '', error: '', startedAt: 1, endedAt: 2, tools: Array.from({length: tools}, (_, i) => ({name: 'tool', title: 'T', ok: true, detailId: JSON.stringify([id, i])}))})
const detail = (id, index, text = 'body') => ({id: JSON.stringify([id, index]), turnId: id, convId: 'c1', index, text, bytes: new TextEncoder().encode(text).byteLength})
const turnOps = (id, tools = 1) => [{store: 'toolDetails', type: 'put', value: detail(id, 0)}, {store: 'turns', type: 'put', value: turn(id, tools)}]
const turnRef = key => ({collection: 'turn', key})

await test('聊天写入与待同步标记同事务；轮次和工具正文作为一个实体发送与回放', async () => {
  const {store, engine, commitWithSync, tables} = runtime(), binding = await store.bind(identity)
  await commitWithSync(turnOps('t1'), [turnRef('t1'), {collection: 'conversation', key: 'c1'}])
  const head = await engine.next(binding.epoch)
  assert.equal(head.ref.collection, 'turn')
  const sampled = await engine.sample(head.ref)
  assert.deepEqual(clean(sampled.value.details.map(item => item.text)), ['body'])
  assert.equal(sampled.value.turn.tools[0].detailId, JSON.stringify(['t1', 0]))
  // 另一设备的轮次带两段正文：入站写入新正文，旧轮次的多余正文被清除，不泄漏孤儿。
  const remote = {turn: turn('t2', 2), details: [detail('t2', 0), detail('t2', 1, 'second')]}
  const result = await engine.applyPage(binding.epoch, undefined, {cursor: 'one', records: [{ref: turnRef('t2'), entityId: 'b'.repeat(64), revision: 1, value: remote, deviceId: 'mobile', operationId: 'r1'}]})
  assert.equal(result.changed, true); assert.equal(tables.toolDetails.size, 3)
  await engine.applyPage(binding.epoch, 'one', {cursor: 'two', records: [{ref: turnRef('t2'), entityId: 'b'.repeat(64), revision: 2, value: {turn: turn('t2', 1), details: [detail('t2', 0, 'changed')]}, deviceId: 'mobile', operationId: 'r2'}]})
  assert.deepEqual([...tables.toolDetails.keys()].sort(), [JSON.stringify(['t1', 0]), JSON.stringify(['t2', 0])].sort())
  await engine.applyPage(binding.epoch, 'two', {cursor: 'three', records: [{ref: turnRef('t2'), entityId: 'b'.repeat(64), revision: 3, value: null, deviceId: 'mobile', operationId: 'r3'}]})
  assert.equal(tables.turns.has('t2'), false); assert.equal(tables.toolDetails.size, 1)
})

await test('聊天身份、工具正文缺失或不属于该轮次的入站值整页拒绝，游标不推进', async () => {
  const {engine, store, tables} = runtime(), binding = await store.bind(identity)
  const bad = [
    {turn: turn('t9', 1), details: []},
    {turn: turn('t9', 1), details: [detail('other', 0)]},
    {turn: turn('t8', 1), details: [detail('t8', 0)]},
  ]
  for (const value of bad) await assert.rejects(engine.applyPage(binding.epoch, undefined, {cursor: 'bad', records: [{ref: turnRef('t9'), entityId: 'b'.repeat(64), revision: 1, value, deviceId: 'mobile', operationId: 'r1'}]}))
  assert.equal((await store.active()).cursor, undefined); assert.equal(tables.turns.size, 0)
})

await test('未绑定时聊天写入只是普通批量写；绑定在采样后变化会重采样而不丢标记', async () => {
  const {store, engine, commitWithSync, tables} = runtime()
  await commitWithSync(turnOps('t1'), [turnRef('t1')])
  assert.equal(tables.turns.has('t1'), true); assert.equal([...tables.incrementalSync.values()].length, 0)
  const binding = await store.bind(identity)
  assert.equal((await engine.next(binding.epoch)).ref.key, 't1') // 绑定时已有轮次作为种子
})

console.log(`应用同步状态机：${count}/${count}`)
