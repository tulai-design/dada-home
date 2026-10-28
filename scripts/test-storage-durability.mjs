import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 测真实公开存储边界，所有浏览器/数据库入口均为隔离替身，不接触用户数据。
function localStore(initial = {}) {
  const rows = new Map(Object.entries(initial))
  return {
    fail: false, failRead: false, rows,
    get length() {return rows.size}, key: i => [...rows.keys()][i] ?? null,
    getItem(key) {if (this.failRead) throw new Error('读取权限暂不可用'); return rows.get(key) ?? null},
    setItem(key, value) {if (this.fail) throw new Error('quota'); rows.set(key, String(value))},
    removeItem(key) {if (this.fail) throw new Error('quota'); rows.delete(key)},
    clear() {rows.clear()},
  }
}
function runtime({storage = localStore(), indexedDB, mocks = {}} = {}) {
  const modules = new Map()
  const scope = {
    localStorage: storage, indexedDB,
    window: {setTimeout() {return 1}, clearTimeout() {}, addEventListener() {}},
    document: {addEventListener() {}, visibilityState: 'visible'},
    setTimeout, clearTimeout, queueMicrotask, structuredClone,
  }
  function load(relative) {
    if (modules.has(relative)) return modules.get(relative)
    const module = {exports: {}}
    modules.set(relative, module.exports)
    const code = ts.transpileModule(readFileSync(new URL('../' + relative, import.meta.url), 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText
    const require = id => {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id === 'react') return {useSyncExternalStore: (_, get) => get(), useCallback: fn => fn, useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect() {}}
      if (id.startsWith('.')) return load(new URL(id + '.ts', 'file:///' + relative).pathname.slice(1))
      throw new Error('未提供测试依赖：' + id)
    }
    vm.runInNewContext(code, {module, exports: module.exports, require, ...scope}, {filename: relative})
    return module.exports
  }
  return {load, storage}
}
function backend() {
  const stores = {kv: new Map(), convs: new Map(), turns: new Map(), recovery: new Map()}
  return {
    stores, fail: false, gate: undefined,
    async all(store) {return [...stores[store].values()]},
    async get(store, key) {return stores[store].get(key)},
    async byIndex(store, field, key) {return [...stores[store].values()].filter(row => row[field] === key)},
    async putMany(store, rows) {return this.batch(rows.map(value => ({store, type: 'put', value})))},
    async batch(operations) {
      if (this.gate) {const gate = this.gate; this.gate = undefined; await gate}
      if (this.fail) throw new Error('事务 abort')
      for (const item of operations) {
        if (item.type === 'clear') stores[item.store].clear()
        else if (item.type === 'delete') stores[item.store].delete(item.key)
        else stores[item.store].set(item.value.k ?? item.value.id, structuredClone(item.value))
      }
    },
    async snapshot() {return {kv: await this.all('kv'), convs: await this.all('convs'), turns: await this.all('turns')}},
  }
}
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done}); return {promise, resolve}}
let passed = 0
async function test(name, run) {await run(); passed += 1; console.log('通过：' + name)}

await test('无 IndexedDB 不伪装成功写入或空查询', async () => {
  const {db, openDb} = runtime().load('src/lib/db.ts')
  assert.equal(await openDb(), null)
  await assert.rejects(db.put('kv', {k: 'fixture', v: 7}))
  await assert.rejects(db.all('kv'))
})
await test('组件事务失败后待写保留，重试写入最新值', async () => {
  const disk = new Map()
  let fail = true
  const backend = {
    async all() {return []},
    async putMany(_, rows) {if (fail) throw new Error("事务 abort"); for (const row of rows) disk.set(row.k, row.v)},
    async delMany(_, ids) {for (const id of ids) disk.delete(id)},
    async batch(operations) {
      if (fail) throw new Error('事务 abort')
      for (const operation of operations) operation.type === 'delete' ? disk.delete(operation.key) : disk.set(operation.value.k, operation.value.v)
    },
  }
  const app = runtime({mocks: {'./db': {db: backend, openDb: async () => ({})}}})
  const data = app.load('src/lib/componentData.ts')
  await data.initComponentData()
  data.writeData('note', {text: 'first'})
  await assert.rejects(data.flush())
  fail = false
  await data.flush()
  assert.equal(disk.get('note')?.text, 'first')
  assert.equal(app.load('src/lib/persistence.ts').getPersistenceStatus().errors.length, 0)
})
await test('旧聊天在数据库不可用时保留来源并允许初始化重试', async () => {
  const storage = localStore({'fp.chatTurns.v2': JSON.stringify([{id: 'old', prompt: '原文', answer: '', reasoning: '', tools: [], error: '', startedAt: 1}])})
  const app = runtime({storage})
  const chat = app.load('src/lib/chat.ts')
  await assert.rejects(chat.initChat())
  assert.ok(storage.getItem('fp.chatTurns.v2'))
  await assert.rejects(chat.initChat())
  assert.ok(storage.getItem('fp.chatTurns.v2'))
})
await test('localStorage失败可见并重试最新值', async () => {
  const storage = localStore()
  const app = runtime({storage})
  const store = app.load('src/lib/store.ts')
  const persistence = app.load('src/lib/persistence.ts')
  storage.fail = true
  store.writeStored('settings', {count: 1})
  store.writeStored('settings', {count: 2})
  assert.equal(persistence.getPersistenceStatus().errors.length, 1)
  assert.throws(() => persistence.assertPersistenceHealthy())
  storage.fail = false
  await persistence.retryPersistence()
  assert.equal(JSON.parse(storage.getItem('fp.settings')).count, 2)
  assert.equal(persistence.getPersistenceStatus().errors.length, 0)
})
await test('并发flush串行，旧删除不会覆盖更新值，调用等待已有事务', async () => {
  const db = backend()
  const app = runtime({mocks: {'./db': {db, openDb: async () => ({})}}})
  const data = app.load('src/lib/componentData.ts')
  await data.initComponentData()
  data.writeData('same', {count: 1})
  await data.flush()
  const paused = deferred()
  db.gate = paused.promise
  data.removeData('same')
  const first = data.flush()
  data.writeData('same', {count: 2})
  let finished = false
  const second = data.flush().then(() => {finished = true})
  await Promise.resolve()
  assert.equal(finished, false)
  paused.resolve()
  await Promise.all([first, second])
  assert.equal(db.stores.kv.get('same').v.count, 2)
})
await test('旧组件单条坏JSON保留，其他合法数据仍迁移且目标新值优先', async () => {
  const db = backend()
  db.stores.kv.set('newer', {k: 'newer', v: 9})
  const storage = localStore({'fp.data.bad': '{', 'fp.data.good': '7', 'fp.data.newer': '1'})
  const app = runtime({storage, mocks: {'./db': {db, openDb: async () => ({})}}})
  const data = app.load('src/lib/componentData.ts')
  await data.initComponentData()
  assert.equal(data.readData('good', 0), 7)
  assert.equal(data.readData('newer', 0), 9)
  assert.equal(storage.getItem('fp.data.good'), null)
  assert.equal(storage.getItem('fp.data.bad'), '{')
  app.load('src/lib/persistence.ts').assertPersistenceHealthy()
})
await test('聊天失败重试完整轮次，并发新编辑不会被旧ack清除', async () => {
  const db = backend()
  const app = runtime({mocks: {'./db': {db, openDb: async () => ({})}}})
  const chat = app.load('src/lib/chat.ts')
  await chat.initChat()
  const turn = {...chat.beginTurn('你好'), id: 'one'}
  chat.useChat().setTurns([turn])
  db.fail = true
  await assert.rejects(chat.flush())
  db.fail = false
  const paused = deferred()
  db.gate = paused.promise
  const first = chat.flush()
  chat.useChat().setTurns([{...turn, answer: '完整原文', endedAt: 2}])
  paused.resolve()
  await first
  const row = db.stores.turns.get('one')
  assert.equal(row.answer, '完整原文')
  assert.ok(db.stores.convs.has(row.convId))
  assert.equal(app.load('src/lib/persistence.ts').getPersistenceStatus().errors.length, 0)
})
await test('迟到的打开会话不覆盖较新的导航请求', async () => {
  const db = backend()
  const app = runtime({mocks: {'./db': {db, openDb: async () => ({})}}})
  const chat = app.load('src/lib/chat.ts')
  await chat.initChat()
  const slow = deferred()
  db.byIndex = async (_, __, id) => id === 'a' ? slow.promise : []
  const first = chat.useChat().openConv('a')
  await Promise.resolve()
  await chat.useChat().openConv('b')
  slow.resolve([])
  await first
  assert.equal(chat.useChat().convId, 'b')
})
await test('单个回落键保存成功不清除其他尚未保存的错误', async () => {
  const storage = localStore()
  const app = runtime({storage})
  const data = app.load('src/lib/componentData.ts')
  const persistence = app.load('src/lib/persistence.ts')
  storage.fail = true
  data.writeData('failed', 1)
  storage.fail = false
  data.writeData('other', 2)
  assert.equal(persistence.getPersistenceStatus().errors.length, 1)
  assert.throws(() => persistence.assertPersistenceHealthy())
  await persistence.retryPersistence()
  assert.equal(storage.getItem('fp.data.failed'), '1')
})
await test('请求成功但事务abort必须reject，不泄漏未处理拒绝', async () => {
  const handle = {
    close() {},
    transaction() {
      const tx = {error: new Error('模拟abort'), abort() {}, objectStore() {return {put() {
        const request = {result: 'key'}
        queueMicrotask(() => {request.onsuccess?.(); queueMicrotask(() => tx.onabort?.())})
        return request
      }}}}
      return tx
    },
  }
  const indexedDB = {open() {const request = {result: handle}; queueMicrotask(() => request.onsuccess?.()); return request}}
  const app = runtime({indexedDB})
  await assert.rejects(app.load('src/lib/db.ts').db.put('kv', {k: 'safe'}), /abort/)
})
await test('恢复门禁阻止新编辑且允许先行flush与保存重试', async () => {
  const storage = localStore()
  const app = runtime({storage})
  const store = app.load('src/lib/store.ts')
  const persistence = app.load('src/lib/persistence.ts')
  storage.fail = true
  store.writeStored('test', 1)
  storage.fail = false
  await persistence.withPersistenceExclusive(async () => {
    assert.equal(persistence.getPersistenceStatus().busy, true)
    assert.throws(() => store.writeStored('test', 2))
    await persistence.retryPersistence()
    assert.equal(storage.getItem('fp.test'), '1')
  })
  assert.equal(persistence.getPersistenceStatus().busy, false)
})
await test('恢复回退也失败后持续阻止编辑直到恢复完成', async () => {
  const app = runtime()
  const persistence = app.load('src/lib/persistence.ts')
  const store = app.load('src/lib/store.ts')
  await assert.rejects(persistence.withPersistenceExclusive(async () => {
    persistence.reportPersistenceError('backup-restore', new Error('回退失败'))
    throw new Error('回退失败')
  }))
  assert.equal(persistence.getPersistenceStatus().busy, false)
  assert.throws(() => store.writeStored('must-stay', 2), /恢复尚未完成/)
  persistence.clearPersistenceError('backup-restore')
  store.writeStored('must-stay', 3)
  assert.equal(app.storage.getItem('fp.must-stay'), '3')
})
await test('读取权限恢复后重试真实读取并清除告警，成功保存也清除旧读取告警', async () => {
  const storage = localStore({'fp.pref': '7', 'fp.broken': '{'})
  const app = runtime({storage})
  const store = app.load('src/lib/store.ts')
  const persistence = app.load('src/lib/persistence.ts')
  storage.failRead = true
  assert.equal(store.readStored('pref', 0), 0)
  assert.throws(() => persistence.assertPersistenceHealthy())
  storage.failRead = false
  await persistence.retryPersistence()
  assert.equal(store.readStored('pref', 0), 7)
  assert.equal(persistence.getPersistenceStatus().errors.length, 0)
  storage.failRead = true
  store.readStored('changed', 0)
  storage.failRead = false
  store.writeStored('changed', 2)
  assert.equal(store.readStored('broken', 0), 0)
  store.writeStored('broken', 3)
  assert.equal(persistence.getPersistenceStatus().errors.length, 0)
})
await test('工作空间读取权限恢复可重试，成功提交清除读取告警且保留最新内存', async () => {
  const storage = localStore()
  const app = runtime({storage, mocks: {
    './ops': {defaultWorkspace: () => ({name: '默认'})}, './registry': {}, './workspace': {},
    './customWidget': {}, '../fx/catalog': {}, './pageIcons': {}, './dock': {},
    './market': {}, './themes': {}, './applications': {}, './pageSections': {},
  }})
  const store = app.load('src/lib/workspaceStore.ts')
  const persistence = app.load('src/lib/persistence.ts')
  storage.failRead = true
  assert.equal(store.getWorkspace().name, '默认')
  storage.failRead = false
  await persistence.retryPersistence()
  assert.equal(persistence.getPersistenceStatus().errors.length, 0)
  const second = runtime({storage, mocks: {
    './ops': {defaultWorkspace: () => ({name: '默认'})}, './registry': {}, './workspace': {},
    './customWidget': {}, '../fx/catalog': {}, './pageIcons': {}, './dock': {},
    './market': {}, './themes': {}, './applications': {}, './pageSections': {},
  }})
  storage.failRead = true
  const workspace = second.load('src/lib/workspaceStore.ts')
  workspace.getWorkspace()
  storage.failRead = false
  workspace.commit({name: '最新编辑'})
  await second.load('src/lib/persistence.ts').retryPersistence()
  assert.equal(workspace.getWorkspace().name, '最新编辑')
  assert.equal(second.load('src/lib/persistence.ts').getPersistenceStatus().errors.length, 0)
})
await test('工作空间连续读取失败不替换默认状态，恢复后实际加载已存工作区', async () => {
  const fixture = {pages: [{id: 'home', name: '已保存的工作区', components: []}]}
  const fallback = {pages: [{id: 'home', name: '默认工作区', components: []}], statusbar: [], layout: {columns: 12, maxWidth: 1200}}
  const storage = localStore({'fp.workspace': JSON.stringify(fixture)})
  const app = runtime({storage, mocks: {
    './ops': {defaultWorkspace: () => fallback}, './registry': {},
    './workspace': {FROZEN_PAGE_ID: 'home', WORKSPACE_VERSION: 6, DEFAULT_THEME_ID: 'default', MAX_STATUS_ITEMS: 4},
    './customWidget': {}, '../fx/catalog': {}, './pageIcons': {}, './dock': {readDock() {}},
    './market': {ADDONS: []}, './themes': {readThemes: () => [{id: 'default'}]},
    './applications': {readApplications: () => []}, './pageSections': {normalizePageSections: page => page},
  }})
  const store = app.load('src/lib/workspaceStore.ts')
  const persistence = app.load('src/lib/persistence.ts')
  storage.failRead = true
  assert.equal(store.getWorkspace().pages[0].name, '默认工作区')
  await assert.rejects(persistence.retryPersistence())
  assert.equal(store.getWorkspace().pages[0].name, '默认工作区')
  storage.failRead = false
  await persistence.retryPersistence()
  assert.equal(store.getWorkspace().pages[0].name, '已保存的工作区')
  assert.equal(persistence.getPersistenceStatus().errors.length, 0)
})
await test('工作空间读取连续重试不覆盖期间失败保存的最新编辑', async () => {
  const storage = localStore()
  const app = runtime({storage, mocks: {
    './ops': {defaultWorkspace: () => ({name: '默认'})}, './registry': {}, './workspace': {},
    './customWidget': {}, '../fx/catalog': {}, './pageIcons': {}, './dock': {},
    './market': {}, './themes': {}, './applications': {}, './pageSections': {},
  }})
  const store = app.load('src/lib/workspaceStore.ts')
  const persistence = app.load('src/lib/persistence.ts')
  storage.failRead = true
  store.getWorkspace()
  storage.fail = true
  store.commit({name: '最新编辑'})
  await assert.rejects(persistence.retryPersistence())
  storage.failRead = false
  storage.fail = false
  await persistence.retryPersistence()
  assert.equal(store.getWorkspace().name, '最新编辑')
  assert.equal(JSON.parse(storage.getItem('fp.workspace')).name, '最新编辑')
})
await test('旧聊天重复ID、缺正文或坏工具拒绝迁移并保留唯一来源', async () => {
  const valid = {id: 'old', prompt: '原文', answer: '', reasoning: '', tools: [], error: '', startedAt: 1}
  for (const turns of [[valid, {...valid, answer: '另一段'}], [{...valid, answer: undefined}], [{...valid, tools: [{name: '坏工具'}]}]]) {
    const source = JSON.stringify(turns)
    const db = backend()
    const storage = localStore({'fp.chatTurns.v2': source})
    const app = runtime({storage, mocks: {'./db': {db}}})
    await assert.rejects(app.load('src/lib/chat.ts').initChat(), /旧聊天数据格式损坏/)
    assert.equal(storage.getItem('fp.chatTurns.v2'), source)
    assert.equal(db.stores.turns.size, 0)
    assert.equal(db.stores.convs.size, 0)
  }
})
await test('恢复失败后允许专用恢复入口重试，仍拒绝嵌套恢复与业务编辑', async () => {
  const app = runtime()
  const persistence = app.load('src/lib/persistence.ts')
  persistence.reportPersistenceError('backup-restore', new Error('回退失败'))
  await persistence.withPersistenceExclusive(async () => {
    assert.throws(() => persistence.assertPersistenceWritable(), /恢复尚未完成/)
    await assert.rejects(persistence.withPersistenceExclusive(async () => {}, {recovering: true}))
    persistence.clearPersistenceError('backup-restore')
  }, {recovering: true})
  assert.doesNotThrow(() => persistence.assertPersistenceWritable())
})
console.log(`持久化回归全部通过：${passed}/${passed}`)
