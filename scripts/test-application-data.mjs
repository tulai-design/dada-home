import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 加载真实仓库/校验/错误状态模块，仅替换 IndexedDB 边界，不接触浏览器用户数据。
function runtime(db, indexedDB, onStoreChange) {
  const modules = new Map()
  const generations = db ? (db.applicationGenerations ??= new Map()) : undefined
  function load(path) {
    if (modules.has(path)) return modules.get(path)
    const module = {exports: {}}
    modules.set(path, module.exports)
    const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText
    const require = id => {
      if (id === 'react') return {useSyncExternalStore: (subscribe, get) => {
        if (onStoreChange) subscribe(() => onStoreChange(get()))
        return get()
      }}
      if (id === './db' && db) return {db}
      if (id === './applicationSyncStore' && db) return {applicationSyncStore: {
        async loadLocal(key) {
          const row = await db.get('apps', key)
          const record = row === undefined ? undefined : load('src/lib/applicationDataSchema.ts').validateApplicationDataRecord(row)
          if (record && record.k !== key) throw new Error('应用存储记录身份不匹配。')
          return {value: record?.v ?? null, generation: generations.get(key) ?? 0}
        },
        async saveLocal(key, value, expected) {
          if ((generations.get(key) ?? 0) !== expected) throw new Error('应用数据已在其他页面更新，请重新加载后继续；新数据未被覆盖。')
          if (value === null) await db.del('apps', key)
          else await db.put('apps', {k: key, v: value})
          generations.set(key, expected + 1)
          return expected + 1
        },
      }}
      if (id.startsWith('.')) return load(new URL(id + '.ts', 'file:///' + path).pathname.slice(1))
      throw new Error('测试缺少依赖：' + id)
    }
    vm.runInNewContext(code, {module, exports: module.exports, require, TextEncoder, indexedDB, Error, queueMicrotask, structuredClone}, {filename: path})
    return module.exports
  }
  return {
    data: load('src/lib/applicationData.ts'),
    schema: load('src/lib/applicationDataSchema.ts'),
    persistence: load('src/lib/persistence.ts'),
    load,
  }
}
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no}); return {promise, resolve, reject}}
const tick = () => new Promise(resolve => setImmediate(resolve))
const ref = (kind = 'app', id = 'same') => ({kind, id})
const clean = value => JSON.parse(JSON.stringify(value))
function backend() {
  const rows = new Map()
  return {
    rows, reads: 0, puts: [], readError: null, writeError: null, readGate: null, writeGate: null,
    async get(store, key) {
      assert.equal(store, 'apps'); this.reads += 1
      if (this.readGate) await this.readGate
      if (this.readError) throw this.readError
      return rows.has(key) ? structuredClone(rows.get(key)) : undefined
    },
    async put(store, row) {
      assert.equal(store, 'apps'); this.puts.push(structuredClone(row))
      const gate = this.writeGate; this.writeGate = null
      if (gate) await gate
      if (this.writeError) throw this.writeError
      rows.set(row.k, structuredClone(row))
    },
    async del(store, key) {
      assert.equal(store, 'apps')
      const gate = this.writeGate; this.writeGate = null
      if (gate) await gate
      if (this.writeError) throw this.writeError
      rows.delete(key)
    },
  }
}
let passed = 0
async function test(name, run) {await run(); passed += 1; console.log('通过：' + name)}

await test('两类同名应用分别保存中文与 emoji 大对象，新的运行环境可完整读回', async () => {
  const db = backend(), app = runtime(db), text = '中文🙂'.repeat(30_001)
  assert.ok(text.length > 100_000)
  await Promise.all([
    app.data.replaceApplicationData(ref('app'), {text}),
    app.data.replaceApplicationData(ref('applet'), {text: text + '小程序'}),
  ])
  const reopened = runtime(db)
  assert.equal((await reopened.data.loadApplicationData(ref('app'))).text, text)
  assert.equal((await reopened.data.loadApplicationData(ref('applet'))).text, text + '小程序')
  assert.equal(db.rows.size, 2)
})

await test('保存 Promise 等待提交，重开读取最新 pending 且不修改原始对象', async () => {
  const db = backend(), app = runtime(db), gate = deferred()
  db.writeGate = gate.promise
  const snapshot = {nested: {count: 7}}
  let confirmed = false
  const saving = app.data.replaceApplicationData(ref(), snapshot).then(() => {confirmed = true})
  snapshot.nested.count = 8
  await tick()
  assert.equal(confirmed, false)
  assert.equal(db.rows.size, 0)
  const current = await app.data.loadApplicationData(ref())
  assert.equal(current.nested.count, 7)
  current.nested.count = 9
  assert.equal((await app.data.loadApplicationData(ref())).nested.count, 7)
  gate.resolve()
  await saving
  assert.equal(db.rows.get('app:same').v.nested.count, 7)
})

await test('并发单键更新只读取一次并合并所有键，危险键名保持普通自有字段', async () => {
  const db = backend(), app = runtime(db), gate = deferred()
  db.readGate = gate.promise
  const first = app.data.setApplicationValue(ref(), 'a', 1)
  const second = app.data.setApplicationValue(ref(), 'b', 2)
  const third = app.data.setApplicationValue(ref(), '__proto__', {safe: true})
  gate.resolve()
  await Promise.all([first, second, third])
  assert.equal(db.reads, 1)
  const saved = clean(db.rows.get('app:same').v)
  assert.equal(saved.a, 1); assert.equal(saved.b, 2)
  assert.equal(Object.hasOwn(saved, '__proto__'), true)
  assert.equal(saved.__proto__.safe, true)
})

await test('读取失败拒绝初始化及覆盖，真实重读成功后才允许保存', async () => {
  const db = backend(), app = runtime(db)
  db.rows.set('app:same', {k: 'app:same', v: {keep: 4}})
  db.readError = new Error('读取权限失败')
  await assert.rejects(app.data.loadApplicationData(ref()), /读取权限/)
  await assert.rejects(app.data.setApplicationValue(ref(), 'new', 5), /读取权限/)
  assert.equal(db.puts.length, 0)
  await assert.rejects(app.persistence.retryPersistence(), /读取权限/)
  assert.equal(db.rows.get('app:same').v.keep, 4)
  db.readError = null
  await app.persistence.retryPersistence()
  assert.deepEqual(clean(await app.data.loadApplicationData(ref())), {keep: 4})
  await app.data.setApplicationValue(ref(), 'new', 5)
  assert.deepEqual(clean(db.rows.get('app:same').v), {keep: 4, new: 5})
  assert.equal(app.persistence.getPersistenceStatus().errors.length, 0)
})

await test('事务失败拒绝调用方并保留待写，重试只提交最新快照', async () => {
  const db = backend(), app = runtime(db)
  db.writeError = new Error('QuotaExceededError：配额不足')
  await assert.rejects(app.data.replaceApplicationData(ref(), {count: 1}), /配额不足/)
  await assert.rejects(app.data.replaceApplicationData(ref(), {count: 2}), /配额不足/)
  assert.equal((await app.data.loadApplicationData(ref())).count, 2)
  assert.equal(app.persistence.getPersistenceStatus().errors.length, 1)
  db.writeError = null
  await app.persistence.retryPersistence()
  assert.equal(db.rows.get('app:same').v.count, 2)
  assert.equal(app.persistence.getPersistenceStatus().errors.length, 0)
})

await test('清除失败状态的同步订阅立即保存时，新请求自行提交且回执不悬挂', async () => {
  const db = backend(), nextGate = deferred()
  let nextWrite, started = false, confirmed = false
  const app = runtime(db, undefined, status => {
    if (status.errors.length || started) return
    started = true
    db.writeGate = nextGate.promise
    nextWrite = app.data.replaceApplicationData(ref(), {count: 2}).then(() => {confirmed = true})
  })
  db.writeError = new Error('事务中断')
  await assert.rejects(app.data.replaceApplicationData(ref(), {count: 1}), /中断/)
  app.persistence.usePersistenceStatus()
  db.writeError = null
  await app.persistence.retryPersistence()
  assert.equal(started, true)
  assert.equal(confirmed, false)
  assert.equal(db.rows.get('app:same').v.count, 1)
  nextGate.resolve()
  let timer
  try {
    // 不调用 flush 兜底：订阅发起的第二次保存必须自行获得事务确认。
    await Promise.race([
      nextWrite,
      new Promise((_, reject) => {timer = setTimeout(() => reject(new Error('同步订阅中的保存回执悬挂')), 500)}),
    ])
  } finally {clearTimeout(timer)}
  assert.equal(confirmed, true)
  assert.equal(db.rows.get('app:same').v.count, 2)
})

await test('旧事务完成不清理更新，较早成功仍成功而后来失败保持待写', async () => {
  const db = backend(), app = runtime(db), firstGate = deferred(), secondGate = deferred()
  db.writeGate = firstGate.promise
  const first = app.data.replaceApplicationData(ref(), {count: 1})
  await tick()
  const second = app.data.replaceApplicationData(ref(), {count: 2})
  const rejected = assert.rejects(second, /中断/)
  db.writeGate = secondGate.promise
  firstGate.resolve()
  await first
  assert.equal(db.rows.get('app:same').v.count, 1)
  db.writeError = new Error('事务中断')
  secondGate.resolve()
  await rejected
  assert.equal((await app.data.loadApplicationData(ref())).count, 2)
  db.writeError = null
  await app.data.flushApplicationData()
  assert.equal(db.rows.get('app:same').v.count, 2)
})

await test('保存屏障包含仍等待初始化的调用，恢复门禁拒绝新写但允许其提交', async () => {
  const db = backend(), app = runtime(db), gate = deferred()
  db.readGate = gate.promise
  const writing = app.data.setApplicationValue(ref(), 'count', 7)
  let flushed = false
  const restoring = app.persistence.withPersistenceExclusive(async () => {
    await assert.rejects(app.data.setApplicationValue(ref(), 'count', 9), /恢复数据/)
    await app.data.flushApplicationData()
    flushed = true
  })
  await tick()
  assert.equal(flushed, false)
  gate.resolve()
  await Promise.all([writing, restoring])
  assert.equal(db.rows.get('app:same').v.count, 7)
})

await test('UTF-8 预算边界按整对象计量，超限保留上一合法版本', async () => {
  const db = backend(), app = runtime(db), limit = app.schema.APPLICATION_DATA_MAX_BYTES
  const overhead = new TextEncoder().encode(JSON.stringify({text: ''})).length
  const exact = {text: 'a'.repeat(limit - overhead)}
  await app.data.replaceApplicationData(ref(), exact)
  await assert.rejects(app.data.setApplicationValue(ref(), 'more', 'a'), /8 MiB/)
  assert.equal(db.rows.get('app:same').v.text.length, limit - overhead)
  await assert.rejects(app.data.replaceApplicationData(ref(), {text: '中'.repeat(Math.floor(limit / 3))}), /8 MiB/)
  await app.data.setApplicationValue(ref(), 'text', '恢复正常')
  assert.equal(db.rows.get('app:same').v.text, '恢复正常')
})

await test('非 JSON、循环、稀疏数组与 getter 拒绝，不发生写入或静默丢字段', async () => {
  const db = backend(), app = runtime(db), cyclic = {}; cyclic.self = cyclic
  const getter = {}; Object.defineProperty(getter, 'secret', {enumerable: true, get() {throw new Error('不应调用 getter')}})
  const symbol = {[Symbol('hidden')]: true}
  const sparse = []; sparse[1] = 2
  for (const value of [{n: NaN}, {n: Infinity}, {u: undefined}, {f() {}}, {d: new Date()}, {m: new Map()}, cyclic, getter, symbol, {sparse}, []]) {
    await assert.rejects(app.data.replaceApplicationData(ref(), value), /JSON/)
  }
  assert.equal(db.puts.length, 0)
})

await test('坏存储行和身份不匹配不能变成缺省空状态', async () => {
  for (const row of [{k: 'app:other', v: {}}, {k: 'app:same', v: []}, {k: 'applet:same', v: {}}, {k: 'app:same', v: {}, extra: 1}]) {
    const db = backend(), app = runtime(db)
    db.rows.set('app:same', row)
    await assert.rejects(app.data.loadApplicationData(ref()))
    await assert.rejects(app.data.replaceApplicationData(ref(), {overwrite: true}))
    assert.equal(db.puts.length, 0)
  }
})

await test('重复相同保存、成功后立即保存和 flush 结束均无悬挂或回退', async () => {
  const db = backend(), app = runtime(db)
  await Promise.all(Array.from({length: 12}, () => app.data.replaceApplicationData(ref(), {count: 1})))
  await app.data.replaceApplicationData(ref(), {count: 2}).then(() => app.data.replaceApplicationData(ref(), {count: 3}))
  await app.data.flushApplicationData()
  assert.equal(db.rows.get('app:same').v.count, 3)
})

await test('显式删除等待持久确认，后续写入不会被较早删除清掉，空对象仍是记录', async () => {
  const db = backend(), app = runtime(db)
  await app.data.replaceApplicationData(ref(), {keep: 1})
  const gate = deferred(); db.writeGate = gate.promise
  const deleting = app.data.deleteApplicationData(ref())
  await tick()
  const later = app.data.replaceApplicationData(ref(), {newer: 2})
  gate.resolve(); await Promise.all([deleting, later])
  assert.deepEqual(clean(db.rows.get('app:same').v), {newer: 2})
  await app.data.deleteApplicationData(ref())
  assert.equal(db.rows.has('app:same'), false)
  await app.data.replaceApplicationData(ref(), {})
  assert.equal(db.rows.has('app:same'), true)
})

await test('另一个运行环境已提交新generation时旧缓存写入被拒绝', async () => {
  const db = backend(), a = runtime(db), b = runtime(db)
  await Promise.all([a.data.loadApplicationData(ref()), b.data.loadApplicationData(ref())])
  await a.data.replaceApplicationData(ref(), {newer: 1})
  await assert.rejects(b.data.replaceApplicationData(ref(), {stale: 2}), /其他页面更新/)
  assert.deepEqual(clean(db.rows.get('app:same').v), {newer: 1})
  await assert.rejects(b.data.flushApplicationData(), /其他页面更新/)
})

await test('真实 DB 模块无 IndexedDB 时明确失败，不回落或报告已保存', async () => {
  const app = runtime()
  await assert.rejects(app.data.loadApplicationData(ref()), /IndexedDB/)
  await assert.rejects(app.data.replaceApplicationData(ref(), {count: 1}), /IndexedDB/)
  assert.equal(app.persistence.getPersistenceStatus().errors.length, 1)
})

await test('数据库版本变化关闭连接并永久阻止重开及业务写，意外 close 可重试', async () => {
  let opens = 0, closes = 0
  const handles = []
  const indexedDB = {open() {
    opens += 1
    const handle = {close() {closes += 1}}
    handles.push(handle)
    const request = {result: handle}
    queueMicrotask(() => request.onsuccess?.())
    return request
  }}
  const app = runtime(undefined, indexedDB), database = app.load('src/lib/db.ts')
  await database.openDb()
  handles[0].onclose()
  await database.openDb()
  assert.equal(opens, 2)
  handles[1].onversionchange()
  assert.equal(database.dbReady(), false)
  await assert.rejects(database.openDb(), /重新加载/)
  await assert.rejects(database.openDb(), /重新加载/)
  await assert.rejects(app.data.replaceApplicationData(ref(), {}), /重新加载/)
  assert.equal(opens, 2)
  assert.equal(closes, 2)
  assert.equal(app.persistence.getPersistenceStatus().errors[0].source, 'db-reload')
  assert.equal(app.persistence.getPersistenceStatus().errors[0].retryable, false)
})
console.log(`应用数据回归全部通过：${passed}/${passed}`)
