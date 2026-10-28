import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as encryption from '@tulai-design/sync-sdk/crypto'

// Coordinator行为使用显式边界替身；真正IDB原子性/跨origin由浏览器验收覆盖。
const scope = {appId: 'dada', spaceId: 'personal'}, keyring = encryption.createKeyring(scope)
function harness() {
  const events = [], intents = [], persisted = [], receipts = new Map(), downloads = new Map(), appliedPages = []
  let binding, gate = false, locked = false, needsReload = false, applyChanged = false, pendingApply = async () => 0
  let page = {cursor: 'cursor-0', commits: [], hasMore: false}, lockTail = Promise.resolve()
  const assertLock = () => assert.equal(locked, true)
  Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {locks: {request(name, options, work) {
    assert.equal(name, 'dada-storage-restore'); assert.equal(options.mode, 'exclusive')
    const next = lockTail.then(async () => {
      if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      locked = true; events.push('lock')
      try {return await work()} finally {locked = false; events.push('unlock')}
    })
    lockTail = next.catch(() => {}); return next
  }}}})
  const store = {
    async active() {return binding && structuredClone(binding)},
    async bind(identity) {
      assertLock(); assert.equal(gate, true); events.push('bind')
      if (!binding) binding = {...identity, epoch: 'epoch-1'}
      return structuredClone(binding)
    },
    async next() {assertLock(); return intents[0] && {ref: {collection: 'applicationData', key: intents[0].applicationKey}, intent: structuredClone(intents[0])}},
    async sample(ref) {assertLock(); return {value: structuredClone(intents.find(item => item.applicationKey === ref.key).value), generation: 1}},
    async prepare(epoch, id, prepared) {
      assertLock(); events.push('prepare'); assert.equal(epoch, binding.epoch)
      const intent = intents.find(item => item.operationId === id)
      intent.prepared = structuredClone(prepared); persisted.push(structuredClone(prepared))
      return structuredClone(intent)
    },
    async checkpoint(epoch, id, checkpoint) {
      assertLock(); events.push('checkpoint'); assert.equal(epoch, binding.epoch)
      intents.find(item => item.operationId === id).checkpoint = structuredClone(checkpoint)
    },
    async acknowledge(epoch, id, receipt) {
      assertLock(); events.push('acknowledge'); assert.equal(epoch, binding.epoch)
      assert.equal(receipt.operationId, id); intents.splice(intents.findIndex(item => item.operationId === id), 1)
    },
    async applyPage(epoch, cursor, incoming) {
      assertLock(); assert.equal(gate, true); events.push('applyPage')
      assert.equal(epoch, binding.epoch); assert.equal(cursor, binding.cursor)
      appliedPages.push(structuredClone(incoming))
      binding.cursor = incoming.cursor; return {changed: applyChanged, conflicts: 0}
    },
    async inspect() {return {binding, records: intents.map(intent => ({collection: 'applicationData', inFlight: intent}))}},
    async resolve() {assertLock(); assert.equal(gate, true); events.push('resolve'); return {changed: true}},
    async detach() {assertLock(); assert.equal(gate, true); events.push('detach'); binding = undefined},
  }
  const persistence = {
    assertPersistenceWritable() {if (needsReload) throw new Error('reload required')},
    async withPersistenceExclusive(work) {
      persistence.assertPersistenceWritable(); assert.equal(gate, false); gate = true; events.push('gate-enter')
      try {return await work()} finally {gate = false; events.push('gate-exit')}
    },
    reportPersistenceError(key) {assert.equal(key, 'sync-reload'); assert.equal(gate, true); needsReload = true; events.push('reload')},
  }
  const client = {
    async capabilities() {assertLock(); events.push('capabilities'); return {records: true, atomicBatch: true, idempotency: true, changeLog: true, objects: true}},
    async operation(id) {assertLock(); events.push('operation'); return receipts.get(id)},
    async uploadObject(blob, options) {
      assertLock(); assert.equal(gate, false); events.push('upload')
      const intent = intents.find(item => item.prepared?.ciphertext.size === blob.size)
      assert.ok(intent?.prepared, '请求与完整密文必须先持久化')
      const descriptor = intent.prepared.request.mutations[0].objectRefs[0]
      await options.onCheckpoint({...scope, ...descriptor, uploadId: 'upload-1'})
      return descriptor
    },
    async commit(request) {
      assertLock(); events.push('commit')
      const receipt = {protocolVersion: 1, operationId: request.operationId, status: 'committed', revision: 1, records: []}
      receipts.set(request.operationId, {request: structuredClone(request), receipt}); return receipt
    },
    async changes(options) {assertLock(); assert.equal(options.limit, 1); events.push('changes'); return page},
    async downloadObject(descriptor, sink) {
      assertLock(); assert.equal(gate, false); events.push('download')
      const bytes = new Uint8Array(await downloads.get(descriptor.sha256).arrayBuffer())
      await sink.write(0, bytes); await sink.commit(); return descriptor
    },
  }
  const modules = new Map()
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    const module = {exports: {}}; modules.set(path, module.exports)
    const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
    const require = id => {
      if (id === '@tulai-design/sync-sdk') return {createSyncClient: () => client}
      if (id === '@tulai-design/sync-sdk/crypto') return encryption
      if (id === './incrementalStore') return {incrementalStore: store}
      if (id === './applicationData') return {async flushApplicationData() {assertLock(); events.push('flush')}}
      if (id === './chat') return {async flush() {assertLock()}}
      if (id === './componentData') return {async flush() {assertLock()}}
      if (id === './incrementalConfig') return {applyPendingConfig: () => pendingApply(), async reconcileConfig() {return 0}}
      if (id === './persistence') return persistence
      if (id.startsWith('.')) return load(new URL(id + '.ts', 'file:///' + path).pathname.slice(1))
      throw new Error('Unknown test import')
    }
    vm.runInThisContext('(function(module, exports, require) {' + code + '\n})', {filename: path})(module, module.exports, require)
    return module.exports
  }
  const factory = load('src/lib/incrementalSync.ts').createIncrementalSyncController
  const makeController = (overrides = {}) => factory({endpoint: 'http://localhost:8787', ...scope, deviceId: 'device-a', token: 'private-token', keyring, ...overrides})
  return {
    events, intents, persisted, receipts, downloads, appliedPages, store, client, persistence, makeController, codec: load('src/lib/incrementalCodec.ts'),
    binding: () => binding, gate: () => gate, setPage(value) {page = value}, setApplyChanged(value) {applyChanged = value}, setPendingApply(work) {pendingApply = work},
    addIntent(id = 'operation-1', value = {text: 'value'}) {intents.push({applicationKey: 'app:' + id, generation: 1, value, operationId: id, baseRevision: null})},
  }
}
let passed = 0
async function test(name, work) {await work(); passed++; console.log('通过：' + name)}

await test('绑定只保存非秘密身份，flush在门禁内，目标变更在联网前失败', async () => {
  const h = harness(), controller = h.makeController()
  await controller.bind()
  assert.match(h.binding().keyFingerprint, /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(h.binding()).includes('private-token'), false)
  assert.deepEqual(Object.keys(h.binding()).sort(), ['appId', 'deviceId', 'endpoint', 'epoch', 'keyFingerprint', 'spaceId'])
  assert.ok(h.events.indexOf('gate-enter') < h.events.indexOf('flush')); assert.ok(h.events.indexOf('flush') < h.events.indexOf('bind'))
  await assert.rejects(h.makeController({spaceId: 'other'}).run())
  await assert.rejects(h.makeController({endpoint: 'http://localhost:8788'}).run(), /绑定/)
  assert.equal(h.events.includes('capabilities'), false)
})

await test('丢失commit响应后查询原operation，复用已存密文/请求，不重传或重新加密', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind(); h.addIntent()
  const commit = h.client.commit
  h.client.commit = async request => {await commit(request); throw new Error('response lost')}
  await assert.rejects(controller.run(), /response lost/)
  assert.equal(h.intents.length, 1); assert.ok(h.intents[0].checkpoint)
  assert.ok(h.events.indexOf('prepare') < h.events.indexOf('operation'))
  assert.ok(h.events.indexOf('checkpoint') < h.events.indexOf('commit'))
  const saved = JSON.stringify(h.persisted[0].request), cipher = new Uint8Array(await h.persisted[0].ciphertext.arrayBuffer())
  const result = await controller.run()
  assert.equal(result.pushed, 1); assert.equal(h.intents.length, 0)
  assert.equal(h.events.filter(x => x === 'prepare').length, 1); assert.equal(h.events.filter(x => x === 'upload').length, 1)
  assert.equal(JSON.stringify(h.persisted[0].request), saved); assert.deepEqual(new Uint8Array(await h.persisted[0].ciphertext.arrayBuffer()), cipher)
})

await test('prepare写盘失败不发送业务请求，maxPush耗尽仍有队列则hasMore=true', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind(); h.addIntent('first'); h.addIntent('second')
  const prepare = h.store.prepare
  h.store.prepare = async () => {throw new Error('storage full')}
  await assert.rejects(controller.run(), /storage full/)
  assert.equal(h.events.includes('operation'), false); assert.equal(h.events.includes('upload'), false)
  h.store.prepare = prepare
  const result = await controller.run({maxPush: 1})
  assert.equal(result.pushed, 1); assert.equal(result.hasMore, true); assert.equal(h.intents.length, 1)
})

await test('未知schema和多record事务不推进cursor，多record在对象下载前拒绝', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind()
  const unsupported = {collection: 'applicationData', schemaVersion: 2, entityId: '0'.repeat(64), revision: 1, deleted: false}
  h.setPage({cursor: 'cursor-1', commits: [{deviceId: 'other', operationId: 'remote', records: [unsupported]}], hasMore: false})
  await assert.rejects(controller.run()); assert.equal(h.binding().cursor, undefined)
  h.setPage({cursor: 'cursor-1', commits: [{deviceId: 'other', operationId: 'remote', records: [unsupported, unsupported]}], hasMore: false})
  await assert.rejects(controller.run(), /每次提交一条同步记录/)
  assert.equal(h.events.includes('download'), false); assert.equal(h.events.includes('applyPage'), false)
})

await test('入站下载期间不持写入门禁，完整认证后flush+原子apply，reload阻止下一轮覆盖', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind()
  const prepared = await h.codec.prepareSyncRecord({ref: {collection: 'applicationData', key: 'app:remote'}, value: {text: 'remote'}, operationId: 'remote', baseRevision: null}, {scope, keyring})
  const {type: _type, baseRevision: _base, ...mutation} = prepared.request.mutations[0]
  h.downloads.set(mutation.objectRefs[0].sha256, prepared.ciphertext)
  h.setPage({cursor: 'cursor-1', commits: [{deviceId: 'other', operationId: 'remote', records: [{...mutation, deleted: false, revision: 1}]}], hasMore: true})
  h.setApplyChanged(true)
  const result = await controller.run()
  assert.equal(result.needsReload, true); assert.equal(result.hasMore, true)
  assert.ok(h.events.lastIndexOf('download') < h.events.lastIndexOf('gate-enter'))
  assert.ok(h.events.lastIndexOf('flush') < h.events.indexOf('applyPage'))
  assert.ok(h.events.indexOf('applyPage') < h.events.indexOf('reload'))
  const count = h.events.filter(x => x === 'capabilities').length
  await assert.rejects(controller.run(), /reload/)
  assert.equal(h.events.filter(x => x === 'capabilities').length, count)
})

await test('一次运行在同一保存门禁内连续拉取多页，达到预算时如实保留hasMore', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind(); h.setApplyChanged(true)
  const pages = [
    {cursor: 'cursor-1', commits: [], hasMore: true},
    {cursor: 'cursor-2', commits: [], hasMore: true},
    {cursor: 'cursor-3', commits: [], hasMore: false},
  ]
  h.client.changes = async () => pages.shift()
  const result = await controller.run({maxPush: 0, maxPull: 2})
  assert.equal(result.hasMore, true)
  assert.equal(h.events.filter(item => item === 'applyPage').length, 2)
  assert.equal(h.events.slice(h.events.indexOf('applyPage')).filter(item => item === 'gate-enter' || item === 'flush').length, 0)
  assert.equal(h.events.filter(item => item === 'reload').length, 2)
  await assert.rejects(controller.run(), /reload/)
})

await test('连续拉取超过50页，后续下载保持只读且不重复flush旧缓存', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind(); h.setApplyChanged(true)
  const prepared = await h.codec.prepareSyncRecord({ref: {collection: 'applicationData', key: 'app:remote'}, value: {text: 'remote'}, operationId: 'remote', baseRevision: null}, {scope, keyring})
  const {type: _type, baseRevision: _base, ...mutation} = prepared.request.mutations[0]
  let index = 0
  h.downloads.set(mutation.objectRefs[0].sha256, prepared.ciphertext)
  h.client.changes = async ({cursor, limit}) => {
    assert.equal(limit, 1)
    assert.equal(cursor, index ? 'cursor-' + index : undefined)
    index++
    return {cursor: 'cursor-' + index, commits: [{deviceId: 'other', operationId: 'remote-' + index, records: [{...mutation, deleted: false, revision: index}]}], hasMore: index < 61}
  }
  h.client.downloadObject = async (descriptor, sink) => {
    assert.equal(h.gate(), index > 1, '仅第一页下载允许编辑')
    if (index > 1) assert.throws(() => h.persistence.assertPersistenceWritable(), /reload/)
    await sink.write(0, new Uint8Array(await prepared.ciphertext.arrayBuffer())); await sink.commit(); return descriptor
  }
  const result = await controller.run({maxPush: 0, maxPull: 10000})
  assert.equal(result.pulled, 61); assert.equal(result.hasMore, false); assert.equal(result.needsReload, true)
  assert.equal(h.binding().cursor, 'cursor-61')
  assert.equal(h.appliedPages.length, 61)
  assert.equal(h.events.slice(h.events.indexOf('applyPage')).includes('flush'), false)
  assert.equal(h.gate(), false)
  await assert.rejects(controller.run(), /reload/)
})

await test('入站后第二页网络失败或取消仍保留重载保护及已提交游标', async () => {
  for (const abort of [false, true]) {
    const h = harness(), controller = h.makeController(); await controller.bind(); h.setApplyChanged(true)
    let page = 0
    h.client.changes = async () => {
      if (++page === 1) return {cursor: 'cursor-1', commits: [], hasMore: true}
      if (abort) {controller.close(); throw new DOMException('Cancelled', 'AbortError')}
      throw new Error('network interrupted')
    }
    await assert.rejects(controller.run({maxPull: 10}), abort ? /Cancelled/ : /network interrupted/)
    assert.equal(h.binding().cursor, 'cursor-1'); assert.equal(h.gate(), false)
    assert.throws(() => h.persistence.assertPersistenceWritable(), /reload/)
  }
})

await test('close取消网络但保留prepared/checkpoint，可由新controller恢复；显式detach保留旧队列', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind(); h.addIntent()
  const upload = h.client.uploadObject
  let uploading; const started = new Promise(resolve => {uploading = resolve})
  h.client.uploadObject = async (blob, options) => {
    await upload(blob, options); uploading()
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once: true}))
  }
  const running = controller.run(); await started; controller.close()
  await assert.rejects(running, error => error.name === 'AbortError')
  assert.ok(h.intents[0].prepared); assert.ok(h.intents[0].checkpoint)
  assert.equal(h.events.includes('acknowledge'), false); assert.equal(h.events.includes('applyPage'), false)
  await assert.rejects(controller.run(), /关闭/)
  h.client.uploadObject = upload
  const resumed = h.makeController(); assert.equal((await resumed.run()).pushed, 1)
  h.addIntent('left-local'); await resumed.detach()
  assert.equal(h.binding(), undefined); assert.equal(h.intents.length, 1)
})

await test('冲突解决传递所见双方版本，在锁和保存屏障内完成并阻止旧缓存继续写回', async () => {
  const h = harness(), controller = h.makeController(); await controller.bind()
  const resolve = h.store.resolve
  h.store.resolve = async (epoch, key, expected, choice) => {
    assert.equal(epoch, h.binding().epoch); assert.equal(key, 'app:conflict')
    assert.deepEqual(expected, {localGeneration: 4, remoteRevision: 9}); assert.equal(choice, 'local')
    assert.equal(h.events.at(-1), 'flush'); return resolve()
  }
  assert.deepEqual(await controller.resolve('app:conflict', {localGeneration: 4, remoteRevision: 9}, 'local'), {changed: true, needsReload: true})
  await assert.rejects(controller.run(), /reload/)
})

await test('恢复行、远端入站与冲突解决在localStorage落盘失败时都保持重载保护', async () => {
  for (const scenario of ['recover', 'apply', 'resolve']) {
    const h = harness(), controller = h.makeController(); await controller.bind(); h.setApplyChanged(true)
    let writes = 0
    h.setPendingApply(async () => {
      if (++writes === (scenario === 'apply' ? 2 : 1)) throw new Error('localStorage full')
      return 0
    })
    if (scenario === 'resolve') await assert.rejects(controller.resolve('app:conflict', {localGeneration: 4, remoteRevision: 9}, 'remote'), /localStorage full/)
    else await assert.rejects(controller.run(), /localStorage full/)
    assert.equal(h.gate(), false)
    assert.throws(() => h.persistence.assertPersistenceWritable(), /reload/)
  }
})

console.log(`应用同步controller通过：${passed}项`)
