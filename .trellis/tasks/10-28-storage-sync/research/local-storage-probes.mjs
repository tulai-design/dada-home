import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

// 现状缺陷复现：只读源码、转译真实模块、使用内存替身；不接浏览器、不请求网络。
// 这些断言刻意确认当前缺陷。修复后失败意味着行为已改变，不能作为产品通过门槛。
const root = new URL('../../../../', import.meta.url)
function load(relative, mocks = {}, scope = {}) {
  const module = {exports: {}}
  const file = new URL(relative, root)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText
  vm.runInNewContext(code, {module, exports: module.exports, require: id => mocks[id] ?? {}, ...scope}, {
    filename: fileURLToPath(file),
  })
  return module.exports
}

const passiveBrowser = () => ({
  window: {clearTimeout() {}, setTimeout() {return 1}, addEventListener() {}},
  document: {addEventListener() {}},
})
let reproduced = 0
async function probe(name, run) {
  const evidence = await run()
  reproduced += 1
  console.log(JSON.stringify({probe: name, currentDefectReproduced: true, evidence}))
}

await probe('IndexedDB 不可用时写入正常 resolve', async () => {
  const {openDb, db} = load('src/lib/db.ts')
  assert.equal(await openDb(), null)
  assert.equal(await db.put('kv', {k: 'fixture', v: 1}), undefined)
  assert.equal((await db.all('kv')).length, 0)
  return {putReturned: 'undefined', allReturned: []}
})

await probe('真实数据库包装吞掉事务 abort', async () => {
  const database = {
    transaction() {
      const tx = {
        error: new Error('模拟事务中止'),
        objectStore: () => ({
          put() {
            const request = {result: 'fixture'}
            queueMicrotask(() => {
              request.onsuccess?.()
              queueMicrotask(() => tx.onabort?.())
            })
            return request
          },
        }),
      }
      return tx
    },
  }
  const indexedDB = {
    open() {
      const request = {result: database}
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
  const {db} = load('src/lib/db.ts', {}, {indexedDB})
  assert.equal(await db.put('kv', {k: 'fixture', v: 1}), undefined)
  return {transaction: 'abort', putReturned: 'undefined'}
})

await probe('localStorage quota 后仅内存更新仍正常返回', () => {
  const store = load('src/lib/store.ts', {}, {
    localStorage: {getItem() {return null}, setItem() {throw new Error('模拟 quota')}},
  })
  store.writeStored('applet.fixture', {count: 7})
  assert.equal(store.readStored('applet.fixture', {}).count, 7)
  return {diskWritten: false, memoryCount: 7}
})

await probe('组件失败写入被移出队列，第二次 flush 不重试', async () => {
  let writes = 0
  const component = load('src/lib/componentData.ts', {
    './db': {openDb: async () => ({}), db: {
      all: async () => [], putMany: async () => {writes += 1}, delMany: async () => {},
    }},
  }, {...passiveBrowser(), localStorage: {length: 0}})
  await component.initComponentData()
  component.writeData('fixture', {count: 9})
  await component.flush()
  await component.flush()
  assert.equal(writes, 1)
  assert.equal(component.readData('fixture', {}).count, 9)
  return {flushCalls: 2, putCalls: writes, diskWritten: false, memoryCount: 9}
})

await probe('并发 flush 的旧删除覆盖新写入', async () => {
  const disk = new Map(), operations = []
  let releaseFirst, first = true, chain = Promise.resolve()
  const firstGate = new Promise(resolve => {releaseFirst = resolve})
  // 按事务请求创建顺序串行执行，复现先 put、后 delete 的跨事务间隙。
  const run = work => {const result = chain.then(work); chain = result; return result}
  const db = {
    all: async () => [],
    putMany: (_store, rows) => run(async () => {
      if (first) {first = false; await firstGate}
      for (const {k, v} of rows) disk.set(k, v)
      operations.push(`put:${rows.map(row => row.k).join(',')}`)
    }),
    delMany: (_store, ids) => run(() => {
      ids.forEach(id => disk.delete(id))
      operations.push(`del:${ids.join(',')}`)
    }),
  }
  const component = load('src/lib/componentData.ts', {'./db': {db, openDb: async () => ({})}}, {
    ...passiveBrowser(), localStorage: {length: 0},
  })
  await component.initComponentData()
  component.writeData('unrelated', {v: 1})
  component.removeData('same-key')
  const oldFlush = component.flush()
  component.writeData('same-key', {v: 2})
  const newFlush = component.flush()
  releaseFirst()
  await Promise.all([oldFlush, newFlush])
  assert.equal(component.readData('same-key', {}).v, 2)
  assert.equal(disk.has('same-key'), false)
  return {operations, memoryValue: 2, diskHasKey: false}
})

await probe('无 IndexedDB 时聊天迁移仍删除唯一旧数据', async () => {
  const legacyKey = 'fp.chatTurns.v2'
  const disk = new Map([[legacyKey, JSON.stringify([{id: 'old-turn', prompt: '旧对话', startedAt: 1, endedAt: 2}])]])
  const {db} = load('src/lib/db.ts')
  const chat = load('src/lib/chat.ts', {
    './db': {db},
    './store': {readStored: (_key, fallback) => fallback, writeStored() {}},
  }, {
    ...passiveBrowser(),
    localStorage: {getItem: key => disk.get(key) ?? null, removeItem: key => disk.delete(key)},
  })
  await chat.initChat()
  assert.equal(disk.has(legacyKey), false)
  assert.equal((await db.all('turns')).length, 0)
  return {legacyStillPresent: false, persistedTurns: 0}
})

await probe('无效 indexedDB:true 备份通过校验并进入清库', async () => {
  const operations = []
  const storage = load('src/lib/storage.ts', {
    './chat': {clearChat: async () => operations.push('clearChat')},
    './componentData': {dropPendingData: () => operations.push('dropPendingData')},
    './db': {openDb: async () => null, db: {
      clear: async () => operations.push('clearKv'),
      putMany: async (name, rows) => operations.push(`put:${name}:${rows.length}`),
    }},
  }, {localStorage: {}, location: {reload: () => operations.push('reload')}})
  const accepted = storage.parseBackup('{"indexedDB":true}')
  assert.equal(accepted.summary.keys, 0)
  await storage.importBackup(accepted.dump)
  assert.ok(operations.includes('clearChat'))
  assert.ok(operations.includes('clearKv'))
  assert.ok(operations.includes('reload'))
  return {accepted: true, operations}
})

console.log(`已复现 ${reproduced} 项现状缺陷；不是产品功能验收通过。`)
