import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'

const require = createRequire(import.meta.url)
const {chromium} = require(process.env.DADA_PLAYWRIGHT_PATH || 'playwright')
const base = (process.env.DADA_QA_URL || 'http://127.0.0.1:5175').replace(/\/$/, '')
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), '浏览器存储测试仅允许隔离本机服务')
const output = process.env.DADA_STORAGE_QA_OUTPUT || '/tmp/dada-storage-browser'
const filter = process.env.DADA_STORAGE_QA_FILTER
// Optional regression proof serves the committed database module into the same
// isolated browser, without checking out or editing any shared product file.
const baselineRef = process.env.DADA_STORAGE_QA_BASELINE_DB
const typescript = baselineRef ? require('typescript') : null
const baselineDb = typescript ? typescript.transpileModule(execFileSync('git', ['show', `${baselineRef}:src/lib/db.ts`], {encoding: 'utf8'}), {compilerOptions: {target: typescript.ScriptTarget.ES2022, module: typescript.ModuleKind.ESNext}}).outputText : null
const browser = await chromium.launch({headless: true})
const results = []
await mkdir(output, {recursive: true})

async function fresh({fixture = true, init} = {}) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, reducedMotion: 'reduce'})
  await context.route('**/*', route => {
    const url = route.request().url()
    if (baselineDb && new URL(url).pathname === '/src/lib/db.ts') return route.fulfill({contentType: 'text/javascript', body: baselineDb})
    return url.startsWith(base + '/') && !new URL(url).pathname.startsWith('/__proxy') ? route.continue() : route.abort()
  })
  if (init) await context.addInitScript(init)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base + (fixture ? '/tests/storage-regressions.html' : '/'), {waitUntil: 'domcontentloaded'})
  if (fixture) await page.waitForFunction(() => window.storageQA && window.storageChat)
  return {context, page, errors}
}

async function check(name, work) {
  if (filter && !name.includes(filter)) return
  const started = Date.now()
  try {await work(); results.push({name, status: 'passed', ms: Date.now() - started}); console.log('通过：' + name)}
  catch (error) {results.push({name, status: 'failed', error: error.stack || String(error), ms: Date.now() - started}); console.error('失败：' + name + '\n' + error.stack)}
}

const legacyTurn = {id: 'legacy-turn', prompt: '旧浏览器唯一记录', answer: '旧答案', reasoning: '', tools: [], error: '', startedAt: 100, endedAt: 110}
const turn = {id: 'saved-turn', convId: 'saved-conv', prompt: '原对话', answer: '原答案', reasoning: '', tools: [], error: '', startedAt: 10, endedAt: 20}
const conv = {id: 'saved-conv', title: '原对话', createdAt: 10, updatedAt: 20}
const original = {local: {'fp.profile': '{"name":"原配置"}', 'fp.conv': '"saved-conv"'}, data: {kv: [{k: 'saved-data', v: {body: '原业务数据'}}], apps: [{k: 'app:saved', v: {body: '原应用数据'}}], convs: [conv], turns: [turn]}}
const target = {app: 'dada-backup', version: 2, 'fp.profile': '{"name":"导入配置"}', indexedDB: {kv: [{k: 'target', v: '目标数据'}], apps: [{k: 'applet:target', v: {body: '目标应用数据'}}], chat: {convs: [], turns: []}}}

async function seed(page, value = original) {
  await page.evaluate(async value => {
    const {db} = window.storageQA.database
    for (const [key, item] of Object.entries(value.local)) localStorage.setItem(key, item)
    await db.batch([...value.data.apps.map(value => ({store: 'apps', type: 'put', value})), ...value.data.kv.map(value => ({store: 'kv', type: 'put', value})), ...value.data.convs.map(value => ({store: 'convs', type: 'put', value})), ...value.data.turns.map(value => ({store: 'turns', type: 'put', value}))])
  }, value)
}
async function snapshot(page) {
  return page.evaluate(async () => ({local: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('fp.')).sort()), data: await window.storageQA.database.db.snapshot()}))
}

try {
  await check('真实IndexedDB：batch请求成功后abort仍拒绝且跨仓回滚', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        const {db} = window.storageQA.database
        await db.put('kv', {k: 'atomic', v: 'before'})
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {
          const request = Reflect.apply(put, this, args)
          if (this.name === 'convs') request.addEventListener('success', () => this.transaction.abort(), {once: true})
          return request
        }
        let rejected = false
        try {await db.batch([{store: 'kv', type: 'put', value: {k: 'atomic', v: 'after'}}, {store: 'convs', type: 'put', value: {id: 'atomic-conv'}}])}
        catch {rejected = true} finally {IDBObjectStore.prototype.put = put}
        return {rejected, value: await db.get('kv', 'atomic'), conv: await db.get('convs', 'atomic-conv')}
      })
      assert.equal(result.rejected, true); assert.deepEqual(result.value, {k: 'atomic', v: 'before'}); assert.equal(result.conv, undefined)
      assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('真实IndexedDB：读取错误与不可克隆写入均严格拒绝', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        const {db} = window.storageQA.database
        await db.put('kv', {k: 'strict', v: 7})
        const getAll = IDBObjectStore.prototype.getAll
        IDBObjectStore.prototype.getAll = function () {throw new DOMException('injected read error', 'UnknownError')}
        let readRejected = false, writeRejected = false
        try {await db.all('kv')} catch {readRejected = true} finally {IDBObjectStore.prototype.getAll = getAll}
        try {await db.put('kv', {k: 'bad', v: () => undefined})} catch {writeRejected = true}
        return {readRejected, writeRejected, rows: await db.all('kv')}
      })
      assert.deepEqual(result, {readRejected: true, writeRejected: true, rows: [{k: 'strict', v: 7}]}); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('组件并发write/delete/write：重入flush屏障保存最终版本并重载', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        const {components, database: {db}} = window.storageQA
        await components.initComponentData()
        const batch = db.batch
        let entered, release
        const admitted = new Promise(resolve => {entered = resolve})
        const gate = new Promise(resolve => {release = resolve})
        let first = true
        db.batch = async operations => {if (first) {first = false; entered(); await gate}; return batch(operations)}
        components.writeData('interleaving', {version: 1})
        const a = components.flush()
        await admitted
        components.removeData('interleaving')
        const b = components.flush()
        components.writeData('interleaving', {version: 3, text: '最终中文值'})
        const c = components.flush()
        release()
        await Promise.all([a, b, c])
        db.batch = batch
        return db.get('kv', 'interleaving')
      })
      assert.deepEqual(result, {k: 'interleaving', v: {version: 3, text: '最终中文值'}})
      await page.reload(); await page.waitForFunction(() => window.storageQA)
      assert.deepEqual(await page.evaluate(async () => {const {components} = window.storageQA; await components.initComponentData(); return components.readData('interleaving', null)}), result.v)
      assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('组件quota失败保留最新值：真实事务失败后重试落盘', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        const {components, persistence, database: {db}} = window.storageQA
        await components.initComponentData()
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {if (this.name === 'kv') throw new DOMException('quota injected', 'QuotaExceededError'); return Reflect.apply(put, this, args)}
        components.writeData('retry', '未保存旧值')
        let rejected = false
        try {await components.flush()} catch {rejected = true}
        components.writeData('retry', '失败后编辑的最新值')
        const failed = persistence.getPersistenceStatus()
        IDBObjectStore.prototype.put = put
        await persistence.retryPersistence()
        return {rejected, failed, status: persistence.getPersistenceStatus(), row: await db.get('kv', 'retry')}
      })
      assert.equal(result.rejected, true); assert.equal(result.failed.errors.length, 1); assert.equal(result.status.errors.length, 0); assert.equal(result.row.v, '失败后编辑的最新值'); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('配置与工作空间读写权限恢复：连续重试保留最新失败编辑', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        const {persistence} = window.storageQA
        const settings = await import('/src/lib/store.ts')
        await import('/src/widgets/index.ts')
        const {defaultWorkspace} = await import('/src/lib/ops.ts')
        const workspace = await import('/src/lib/workspaceStore.ts')
        const saved = defaultWorkspace()
        saved.pages[0].name = '磁盘旧工作空间'
        localStorage.setItem('fp.workspace', JSON.stringify(saved))
        localStorage.setItem('fp.qa-read-write', JSON.stringify({value: '磁盘旧设置'}))
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem
        let denyRead = true, denyWrite = true
        Storage.prototype.getItem = function (key) {if (this === localStorage && denyRead && ['fp.workspace', 'fp.qa-read-write'].includes(key)) throw new DOMException('read permission', 'SecurityError'); return Reflect.apply(get, this, [key])}
        Storage.prototype.setItem = function (key, value) {if (this === localStorage && denyWrite && ['fp.workspace', 'fp.qa-read-write'].includes(key)) throw new DOMException('write permission', 'QuotaExceededError'); return Reflect.apply(set, this, [key, value])}
        try {
          workspace.getWorkspace()
          settings.readStored('qa-read-write', null)
          const edited = {...workspace.getWorkspace(), pages: workspace.getWorkspace().pages.map((page, i) => i ? page : {...page, name: '失败期间最新工作空间'})}
          workspace.commit(edited)
          settings.writeStored('qa-read-write', {value: '失败期间最新设置'})
          let rejected = false
          try {await persistence.retryPersistence()} catch {rejected = true}
          denyRead = false; denyWrite = false
          await persistence.retryPersistence()
          return {rejected, memoryWorkspace: workspace.getWorkspace().pages[0].name, diskWorkspace: JSON.parse(localStorage.getItem('fp.workspace')).pages[0].name, memorySettings: settings.readStored('qa-read-write', null), diskSettings: JSON.parse(localStorage.getItem('fp.qa-read-write')), status: persistence.getPersistenceStatus()}
        } finally {Storage.prototype.getItem = get; Storage.prototype.setItem = set}
      })
      assert.equal(result.rejected, true); assert.equal(result.memoryWorkspace, '失败期间最新工作空间'); assert.equal(result.diskWorkspace, result.memoryWorkspace); assert.deepEqual(result.memorySettings, {value: '失败期间最新设置'}); assert.deepEqual(result.diskSettings, result.memorySettings); assert.deepEqual(result.status.errors, []); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('聊天流式更改立即export：全部轮次与组件最新值可重载', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        const qa = window.storageQA
        await qa.storage.initStorage()
        const next = qa.chat.beginTurn('立即导出的提问')
        window.storageChat.setTurns([next])
        for (const answer of ['流', '流式', '流式完整答复']) window.storageChat.setTurns(prev => prev.map(item => ({...item, answer, endedAt: item.startedAt + 5})))
        qa.components.writeData('immediate', '立即导出的组件数据')
        return qa.storage.exportIdb()
      })
      assert.equal(result.chat.turns.length, 1); assert.equal(result.chat.turns[0].answer, '流式完整答复'); assert.equal(result.kv.find(item => item.k === 'immediate')?.v, '立即导出的组件数据')
      await page.reload(); await page.waitForFunction(() => window.storageQA)
      const reloaded = await page.evaluate(async () => {await window.storageQA.storage.initStorage(); return window.storageQA.storage.exportIdb()})
      assert.deepEqual(reloaded, result); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('聊天快速切换：迟到读取不覆盖最新会话，原轮次归属不变', async () => {
    const {page, context, errors} = await fresh()
    try {
      await seed(page, {local: original.local, data: {kv: [], apps: [], convs: [conv, {...conv, id: 'conv-b', title: 'B'}, {...conv, id: 'conv-c', title: 'C'}], turns: [turn, {...turn, id: 'turn-b', convId: 'conv-b', answer: 'B原值'}, {...turn, id: 'turn-c', convId: 'conv-c', answer: 'C原值'}]}})
      const result = await page.evaluate(async () => {
        const qa = window.storageQA
        await qa.storage.initStorage()
        window.storageChat.setTurns(prev => prev.map(item => ({...item, answer: '切换前A最新答复'})))
        const byIndex = qa.database.db.byIndex
        let entered, release
        const admitted = new Promise(resolve => {entered = resolve})
        const gate = new Promise(resolve => {release = resolve})
        qa.database.db.byIndex = async (store, index, key) => {const value = await byIndex(store, index, key); if (key === 'conv-b') {entered(); await gate}; return value}
        const b = window.storageChat.openConv('conv-b')
        await admitted
        await window.storageChat.openConv('conv-c')
        release()
        await b
        qa.database.db.byIndex = byIndex
        await new Promise(resolve => requestAnimationFrame(resolve))
        return {convId: window.storageChat.convId, current: window.storageChat.turns, rows: (await qa.storage.exportIdb()).chat.turns}
      })
      assert.equal(result.convId, 'conv-c'); assert.equal(result.current[0].id, 'turn-c')
      assert.equal(result.rows.find(item => item.id === turn.id).convId, conv.id); assert.equal(result.rows.find(item => item.id === turn.id).answer, '切换前A最新答复')
      assert.equal(result.rows.find(item => item.id === 'turn-b').answer, 'B原值'); assert.equal(result.rows.find(item => item.id === 'turn-c').answer, 'C原值'); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('旧聊天迁移：事务完成且读回后删来源，重启不重复', async () => {
    const {page, context, errors} = await fresh()
    try {
      await page.evaluate(value => localStorage.setItem('fp.chatTurns.v2', JSON.stringify([value])), legacyTurn)
      const result = await page.evaluate(async () => {await window.storageQA.storage.initStorage(); return {data: await window.storageQA.storage.exportIdb(), legacy: localStorage.getItem('fp.chatTurns.v2')}})
      assert.equal(result.legacy, null); assert.equal(result.data.chat.turns.length, 1); assert.equal(result.data.chat.turns[0].prompt, legacyTurn.prompt); assert.equal(result.data.chat.convs.length, 1); assert.equal(result.data.chat.turns[0].convId, result.data.chat.convs[0].id)
      await page.reload(); await page.waitForFunction(() => window.storageQA)
      assert.equal(await page.evaluate(async () => {await window.storageQA.storage.initStorage(); return (await window.storageQA.storage.exportIdb()).chat.turns.length}), 1); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('旧聊天迁移abort：保留唯一来源，恢复后同页重试不重复', async () => {
    const {page, context, errors} = await fresh()
    try {
      await page.evaluate(value => localStorage.setItem('fp.chatTurns.v2', JSON.stringify([value])), legacyTurn)
      const result = await page.evaluate(async () => {
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {if (this.name === 'turns') throw new DOMException('migration quota', 'QuotaExceededError'); return Reflect.apply(put, this, args)}
        let rejected = false
        try {await window.storageQA.storage.initStorage()} catch {rejected = true}
        const retained = localStorage.getItem('fp.chatTurns.v2')
        IDBObjectStore.prototype.put = put
        await window.storageQA.storage.initStorage()
        return {rejected, retained, legacy: localStorage.getItem('fp.chatTurns.v2'), data: await window.storageQA.storage.exportIdb()}
      })
      assert.equal(result.rejected, true); assert.ok(result.retained); assert.equal(result.legacy, null); assert.equal(result.data.chat.turns.length, 1); assert.equal(result.data.chat.convs.length, 1); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('旧聊天迁移读回失败：保留来源并复用已提交身份重试', async () => {
    const {page, context, errors} = await fresh()
    try {
      await page.evaluate(value => localStorage.setItem('fp.chatTurns.v2', JSON.stringify([value])), legacyTurn)
      const result = await page.evaluate(async () => {
        const get = IDBObjectStore.prototype.get
        let turnReads = 0
        IDBObjectStore.prototype.get = function (...args) {if (this.name === 'turns' && ++turnReads === 2) throw new DOMException('verify read failed', 'UnknownError'); return Reflect.apply(get, this, args)}
        let rejected = false
        try {await window.storageQA.storage.initStorage()} catch {rejected = true}
        const retained = localStorage.getItem('fp.chatTurns.v2')
        IDBObjectStore.prototype.get = get
        const committed = await window.storageQA.database.db.all('turns')
        await window.storageQA.storage.initStorage()
        return {rejected, retained, committed, source: localStorage.getItem('fp.chatTurns.v2'), saved: (await window.storageQA.storage.exportIdb()).chat}
      })
      assert.equal(result.rejected, true); assert.ok(result.retained); assert.equal(result.source, null); assert.equal(result.committed.length, 1); assert.equal(result.saved.turns.length, 1); assert.equal(result.saved.convs.length, 1); assert.equal(result.saved.turns[0].convId, result.committed[0].convId); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('旧组件坏JSON：原值保留且合法项继续迁移', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        localStorage.setItem('fp.data.broken', '{broken')
        localStorage.setItem('fp.data.good', JSON.stringify({text: '合法组件'}))
        await window.storageQA.components.initComponentData()
        return {broken: localStorage.getItem('fp.data.broken'), good: localStorage.getItem('fp.data.good'), row: await window.storageQA.database.db.get('kv', 'good')}
      })
      assert.deepEqual(result, {broken: '{broken', good: null, row: {k: 'good', v: {text: '合法组件'}}}); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('旧聊天不完整行或重复ID：迁移拒绝并保留全部原文', async () => {
    for (const records of [[{id: 'incomplete', prompt: '缺失字段', startedAt: 1}], [{...legacyTurn, id: 'duplicate', answer: '第一份独有答案'}, {...legacyTurn, id: 'duplicate', answer: '第二份答案'}]]) {
      const {page, context, errors} = await fresh()
      try {
        const result = await page.evaluate(async records => {
          const source = JSON.stringify(records)
          localStorage.setItem('fp.chatTurns.v2', source)
          let rejected = false
          try {await window.storageQA.storage.initStorage()} catch {rejected = true}
          return {source, retained: localStorage.getItem('fp.chatTurns.v2'), rejected, rows: await window.storageQA.database.db.all('turns')}
        }, records)
        assert.equal(result.rejected, true); assert.equal(result.retained, result.source); assert.deepEqual(result.rows, []); assert.deepEqual(errors, [])
      } finally {await context.close()}
    }
  })

  await check('坏备份拒绝：结构/版本/工作空间/应用坏行与重复ID不改原数据', async () => {
    const {page, context, errors} = await fresh()
    try {
      await seed(page)
      const before = await snapshot(page)
      const rejected = await page.evaluate(async ({target}) => {
        const invalidApps = [[{k: 'app:incomplete'}], [{k: 'applet:same', v: {answer: '第一份'}}, {k: 'applet:same', v: {answer: '第二份'}}]]
        const variants = [{indexedDB: true}, {...target, version: 999}, {...target, indexedDB: {kv: []}}, {...target, indexedDB: {kv: [{k: 1, v: 'bad'}], apps: [], chat: {convs: [], turns: []}}}, ...['[]', 'null', '{"pages":[]}'].map(value => ({...target, 'fp.workspace': value})), ...invalidApps.map(apps => ({...target, indexedDB: {...target.indexedDB, apps}}))]
        const result = []
        for (const candidate of variants) {
          try {const {dump} = window.storageQA.storage.parseBackup(JSON.stringify(candidate)); await window.storageQA.storage.importBackup(dump); result.push(false)} catch {result.push(true)}
        }
        return result
      }, {target, legacyTurn})
      assert.deepEqual(rejected, Array(9).fill(true)); assert.deepEqual(await snapshot(page), before); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('新版备份夹带旧业务键：清库前拒绝且不触发重载迁移', async () => {
    const {page, context, errors} = await fresh()
    try {
      await seed(page)
      const before = await snapshot(page)
      const result = await page.evaluate(async target => {
        const rejected = []
        for (const key of ['fp.chatTurns.v2', 'fp.data.shadow', 'fp.app.saved', 'fp.applet.target']) {
          const candidate = {...target, [key]: '{}'}
          let parseError = '', importError = ''
          try {window.storageQA.storage.parseBackup(JSON.stringify(candidate))} catch (error) {parseError = error.message}
          try {await window.storageQA.storage.importBackup(candidate)} catch (error) {importError = error.message}
          rejected.push({parseError, importError})
        }
        return {rejected, recovery: await window.storageQA.database.db.all('recovery')}
      }, target)
      for (const item of result.rejected) {assert.match(item.parseError, /旧业务存储/); assert.match(item.importError, /旧业务存储/)}
      assert.deepEqual(result.recovery, []); assert.deepEqual(await snapshot(page), before); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('恢复LS失败：原IndexedDB和fp配置回退且恢复日志清除', async () => {
    const {page, context, errors} = await fresh()
    try {
      await seed(page)
      const before = await snapshot(page)
      const rejected = await page.evaluate(async target => {
        const set = Storage.prototype.setItem
        let fail = true
        Storage.prototype.setItem = function (key, value) {if (this === localStorage && key === 'fp.profile' && fail) {fail = false; throw new DOMException('restore quota', 'QuotaExceededError')}; return Reflect.apply(set, this, [key, value])}
        try {await window.storageQA.storage.importBackup(target); return false} catch {return true} finally {Storage.prototype.setItem = set}
      }, target)
      assert.equal(rejected, true); assert.deepEqual(await snapshot(page), before); assert.deepEqual(await page.evaluate(() => window.storageQA.database.db.all('recovery')), []); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('恢复中断重启：durable recovery日志在业务初始化前回退', async () => {
    const {page, context, errors} = await fresh()
    try {
      await page.evaluate(async ({original, target}) => {
        localStorage.setItem('fp.profile', target['fp.profile'])
        localStorage.setItem('fp.partial', '"崩溃后的半成品"')
        await window.storageQA.database.db.batch([{store: 'recovery', type: 'put', value: {k: 'backup-restore', version: 2, before: original}}, {store: 'kv', type: 'put', value: target.indexedDB.kv[0]}])
      }, {original, target})
      await page.reload(); await page.waitForFunction(() => window.storageQA)
      await page.evaluate(() => window.storageQA.storage.initStorage())
      assert.deepEqual(await snapshot(page), original); assert.deepEqual(await page.evaluate(() => window.storageQA.database.db.all('recovery')), []); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('恢复和回退均失败：真实导入保留日志，重载恢复原数据', async () => {
    const {page, context, errors} = await fresh()
    try {
      await seed(page)
      const before = await snapshot(page)
      const failed = await page.evaluate(async target => {
        const set = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {if (this === localStorage && key === 'fp.profile') throw new DOMException('persistent restore quota', 'QuotaExceededError'); return Reflect.apply(set, this, [key, value])}
        let rejected = false
        try {await window.storageQA.storage.importBackup(target)} catch {rejected = true}
        finally {Storage.prototype.setItem = set}
        return {rejected, log: await window.storageQA.database.db.get('recovery', 'backup-restore')}
      }, target)
      assert.equal(failed.rejected, true); assert.deepEqual(failed.log.before, before)
      await page.reload(); await page.waitForFunction(() => window.storageQA)
      await page.evaluate(() => window.storageQA.storage.initStorage())
      assert.deepEqual(await snapshot(page), before); assert.deepEqual(await page.evaluate(() => window.storageQA.database.db.all('recovery')), []); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('数据库升级blocked：失败可见，关闭旧连接后重试，versionchange拒绝旧页继续写入', async () => {
    const {page, context, errors} = await fresh()
    try {
      const result = await page.evaluate(async () => {
        const old = await new Promise((resolve, reject) => {const request = indexedDB.open('dada', 1); request.onupgradeneeded = () => {for (const [name, keyPath] of [['kv', 'k'], ['convs', 'id'], ['turns', 'id']]) {const store = request.result.createObjectStore(name, {keyPath}); if (name === 'turns') store.createIndex('convId', 'convId')}}; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)})
        let blocked = ''
        try {await window.storageQA.database.openDb()} catch (error) {blocked = error.message}
        old.close()
        const upgraded = await window.storageQA.database.openDb()
        const version = upgraded.version
        await window.storageQA.database.db.put('kv', {k: 'upgrade', v: '升级后可保存'})
        upgraded.dispatchEvent(new Event('versionchange'))
        let reopenError = '', writeError = ''
        try {await window.storageQA.database.openDb()} catch (error) {reopenError = error.message}
        try {window.storageQA.persistence.assertPersistenceWritable()} catch (error) {writeError = error.message}
        return {blocked, version, reopenError, writeError, errors: window.storageQA.persistence.getPersistenceStatus().errors}
      })
      assert.match(result.blocked, /阻挡|标签页/); assert.equal(result.version, 3); assert.match(result.reopenError, /重新加载/); assert.match(result.writeError, /重新加载/); assert.ok(result.errors.some(error => error.source === 'db-reload'));
      await page.reload(); await page.waitForFunction(() => window.storageQA)
      assert.equal(await page.evaluate(async () => (await window.storageQA.database.db.get('kv', 'upgrade')).v), '升级后可保存'); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('真实App无IndexedDB启动失败：旧聊天保留，恢复API后重新读取进入首页', async () => {
    const {page, context, errors} = await fresh({fixture: false, init: () => {window.__nativeIndexedDB = indexedDB; Object.defineProperty(window, 'indexedDB', {configurable: true, value: undefined}); localStorage.setItem('fp.chatTurns.v2', JSON.stringify([{id: 'only-copy', prompt: '不可删除的旧数据', answer: '保留', reasoning: '', tools: [], error: '', startedAt: 1, endedAt: 2}]))}})
    try {
      await page.getByRole('heading', {name: '暂时无法读取本地数据'}).waitFor()
      assert.ok(await page.evaluate(() => localStorage.getItem('fp.chatTurns.v2')))
      assert.equal(await page.locator('.canvas').count(), 0)
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({width, height: 900})
        assert.ok(await page.getByRole('alert').evaluate(element => {const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 && element.scrollWidth <= element.clientWidth + 1}))
      }
      await page.setViewportSize({width: 320, height: 900})
      await page.screenshot({path: output + '/startup-320.png'})
      await page.evaluate(() => Object.defineProperty(window, 'indexedDB', {configurable: true, value: window.__nativeIndexedDB}))
      await page.getByRole('button', {name: '重新读取', exact: true}).click()
      await page.locator('.canvas').waitFor()
      const migrated = await page.evaluate(async () => {const {db} = await import('/src/lib/db.ts'); return {turns: await db.all('turns'), source: localStorage.getItem('fp.chatTurns.v2')}})
      assert.equal(migrated.turns.length, 1); assert.equal(migrated.source, null); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('真实启动救援下载：保留坏JSON原文，标记配置救援且拒作完整备份', async () => {
    const {page, context, errors} = await fresh({fixture: false, init: () => {
      Object.defineProperty(window, 'indexedDB', {configurable: true, value: undefined})
      localStorage.setItem('fp.profile', '{bad profile原始损坏内容')
      localStorage.setItem('fp.chatTurns.v2', '{bad chat旧唯一来源')
      localStorage.setItem('unrelated', '不导出其他应用数据')
    }})
    try {
      await page.getByRole('heading', {name: '暂时无法读取本地数据'}).waitFor()
      await page.getByText(/不能直接作为完整备份导入/).waitFor()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: '导出原始配置', exact: true}).click()])
      assert.match(download.suggestedFilename(), /^dada-local-rescue-\d+\.json$/)
      const raw = await readFile(await download.path(), 'utf8'), dump = JSON.parse(raw)
      assert.deepEqual(dump, {app: 'dada-local-rescue', version: 1, local: {'fp.profile': '{bad profile原始损坏内容', 'fp.chatTurns.v2': '{bad chat旧唯一来源'}})
      assert.equal(Object.hasOwn(dump, 'indexedDB'), false)
      const preserved = await page.evaluate(async raw => {
        let rejected = false
        try {(await import('/src/lib/storage.ts')).parseBackup(raw)} catch {rejected = true}
        return {rejected, profile: localStorage.getItem('fp.profile'), chat: localStorage.getItem('fp.chatTurns.v2')}
      }, raw)
      assert.deepEqual(preserved, {rejected: true, profile: dump.local['fp.profile'], chat: dump.local['fp.chatTurns.v2']})
      const downloads = []
      page.on('download', value => downloads.push(value.suggestedFilename()))
      await page.evaluate(() => {const get = Storage.prototype.getItem; Storage.prototype.getItem = function (key) {if (this === localStorage && key.startsWith('fp.')) throw new DOMException('rescue read denied', 'SecurityError'); return Reflect.apply(get, this, [key])}})
      await page.getByRole('button', {name: '导出原始配置', exact: true}).click()
      await page.getByText('浏览器暂时不允许读取配置，请保留当前页面和浏览器数据。').waitFor()
      assert.deepEqual(downloads, [], '读取失败不下载成功空救援'); assert.deepEqual(errors, [])
      await writeFile(output + '/rescue.json', raw)
    } finally {await context.close()}
  })

  await check('真实启动回退失败：恢复权限后同页重新读取成功，原数据恢复', async () => {
    const {page, context, errors} = await fresh()
    try {
      await page.evaluate(async ({original, target}) => {
        localStorage.setItem('fp.profile', target['fp.profile'])
        await window.storageQA.database.db.batch([{store: 'recovery', type: 'put', value: {k: 'backup-restore', version: 2, before: original}}, {store: 'kv', type: 'put', value: target.indexedDB.kv[0]}])
      }, {original, target})
      await page.addInitScript(() => {
        window.__qaNativeSet = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {if (this === localStorage && key === 'fp.profile') throw new DOMException('startup rollback quota', 'QuotaExceededError'); return Reflect.apply(window.__qaNativeSet, this, [key, value])}
      })
      await page.goto(base + '/', {waitUntil: 'domcontentloaded'})
      await page.getByRole('heading', {name: '暂时无法读取本地数据'}).waitFor()
      assert.equal(await page.locator('.canvas').count(), 0)
      await page.evaluate(() => {Storage.prototype.setItem = window.__qaNativeSet})
      await page.getByRole('button', {name: '重新读取', exact: true}).click()
      await page.locator('.canvas').waitFor()
      const restored = await page.evaluate(async () => {const {db} = await import('/src/lib/db.ts'); return {data: await db.snapshot(), logs: await db.all('recovery'), profile: localStorage.getItem('fp.profile')}})
      assert.deepEqual(restored.data, original.data); assert.equal(restored.profile, original.local['fp.profile']); assert.deepEqual(restored.logs, []); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('真实设置导出按钮：下载备份可解析并包含未flush最新组件与配置', async () => {
    const {page, context, errors} = await fresh()
    try {
      await seed(page)
      await page.goto(base + '/', {waitUntil: 'domcontentloaded'})
      await page.locator('.canvas').waitFor()
      await page.getByRole('navigation', {name: '侧边导航'}).getByRole('button', {name: '设置', exact: true}).click()
      await page.locator('.ios-side').getByRole('button', {name: '数据', exact: true}).click()
      await page.evaluate(async () => {
        const data = await import('/src/lib/componentData.ts')
        const settings = await import('/src/lib/store.ts')
        data.writeData('button-export', {text: '导出按钮点击前最新组件值'})
        settings.writeStored('profile', {name: '导出按钮点击前最新配置'})
      })
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', {name: '导出备份', exact: true}).click()])
      assert.match(download.suggestedFilename(), /^dada-backup-\d{4}-\d{2}-\d{2}\.json$/)
      const raw = await readFile(await download.path(), 'utf8')
      const dump = await page.evaluate(async raw => (await import('/src/lib/storage.ts')).parseBackup(raw).dump, raw)
      assert.equal(dump.app, 'dada-backup'); assert.equal(dump.version, 2)
      assert.equal(JSON.parse(dump['fp.profile']).name, '导出按钮点击前最新配置')
      assert.deepEqual(dump.indexedDB.kv.find(item => item.k === 'button-export').v, {text: '导出按钮点击前最新组件值'})
      assert.equal(dump.indexedDB.chat.turns.find(item => item.id === turn.id).answer, turn.answer)
      assert.deepEqual(errors, [])
      await writeFile(output + '/settings-backup.json', raw)
    } finally {await context.close()}
  })

  await check('真实App保存失败Notice：旧警告后quota优先、四宽双主题、重试与输入保持', async () => {
    const {page, context, errors} = await fresh({fixture: false, init: () => localStorage.setItem('fp.data.broken-notice', '{bad old component')})
    try {
      await page.locator('.canvas').waitFor()
      const input = page.locator('.hero-input input')
      await input.fill('现有首页输入保持可用')
      assert.equal(await input.inputValue(), '现有首页输入保持可用', '首页输入事件写入受控值')
      const node = await input.elementHandle()
      await page.evaluate(async () => {
        const data = await import('/src/lib/componentData.ts')
        window.__storageNativePut = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) {if (this.name === 'kv') throw new DOMException('浏览器存储空间不足，请释放空间后重试。', 'QuotaExceededError'); return Reflect.apply(window.__storageNativePut, this, args)}
        data.writeData('notice-probe', {text: '重试保留此值'})
        try {await data.flush()} catch {}
      })
      const notice = page.getByRole('alert', {name: '本地保存失败'})
      await notice.waitFor()
      await notice.getByText('浏览器存储空间不足，请释放空间后重试。', {exact: true}).waitFor()
      assert.equal(await input.inputValue(), '现有首页输入保持可用', '显示保存失败前后输入保留')
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({width, height: 900})
        for (const mode of ['light', 'dark']) {
          await page.evaluate(async mode => {const {commit, getWorkspace} = await import('/src/lib/workspaceStore.ts'); const ws = getWorkspace(); commit({...ws, theme: {...ws.theme, mode}})}, mode)
          const geometry = await notice.evaluate(element => {
            const r = element.getBoundingClientRect(), button = element.querySelector('button'), b = button.getBoundingClientRect()
            return {left: r.left, right: r.right, width: innerWidth, overflow: element.scrollWidth - element.clientWidth, buttonHit: button.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)), bg: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color}
          })
          assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1); assert.ok(geometry.overflow <= 1); assert.equal(geometry.buttonHit, true)
          assert.equal(await node.evaluate(element => element.isConnected), true); assert.equal(await input.inputValue(), '现有首页输入保持可用', `${width}px ${mode}主题下输入保留`)
          if (width === 320 || width === 1440) await page.screenshot({path: `${output}/notice-${width}-${mode}.png`})
        }
      }
      await page.evaluate(() => {IDBObjectStore.prototype.put = window.__storageNativePut})
      await notice.getByRole('button', {name: '重试保存', exact: true}).click()
      await notice.getByText('部分旧数据未能读取', {exact: true}).waitFor()
      assert.equal(await notice.getByRole('button', {name: '重试保存', exact: true}).count(), 0, '成功写入后仅保留原文损坏警告')
      assert.equal(await page.evaluate(async () => (await (await import('/src/lib/db.ts')).db.get('kv', 'notice-probe')).v.text), '重试保留此值')
      await input.fill('重试后仍可编辑'); assert.equal(await input.inputValue(), '重试后仍可编辑')
      assert.deepEqual(errors, [])
    } finally {await context.close()}
  })

  await check('真实App恢复双失败：提示重新加载、业务inert与写门禁、重载恢复', async () => {
    const {page, context, errors} = await fresh()
    try {
      await seed(page)
      await page.goto(base + '/', {waitUntil: 'domcontentloaded'})
      await page.locator('.canvas').waitFor()
      const result = await page.evaluate(async target => {
        const set = Storage.prototype.setItem
        Storage.prototype.setItem = function (key, value) {if (this === localStorage && key === 'fp.profile') throw new DOMException('import and rollback failed', 'QuotaExceededError'); return Reflect.apply(set, this, [key, value])}
        let rejected = false, editRejected = false
        try {await (await import('/src/lib/storage.ts')).importBackup(target)} catch {rejected = true}
        finally {Storage.prototype.setItem = set}
        try {(await import('/src/lib/componentData.ts')).writeData('must-not-write', '不应保存')} catch {editRejected = true}
        return {rejected, editRejected}
      }, target)
      assert.deepEqual(result, {rejected: true, editRejected: true})
      const notice = page.getByRole('alert', {name: '本地保存失败'})
      await notice.getByText('数据恢复尚未完成', {exact: true}).waitFor()
      assert.equal(await page.locator('.app').getAttribute('inert'), '')
      await Promise.all([page.waitForNavigation({waitUntil: 'domcontentloaded'}), notice.getByRole('button', {name: '重新加载', exact: true}).click()])
      await page.locator('.canvas').waitFor()
      const restored = await page.evaluate(async () => {const {db} = await import('/src/lib/db.ts'); return {data: await db.snapshot(), logs: await db.all('recovery'), profile: localStorage.getItem('fp.profile')}})
      assert.deepEqual(restored.data, original.data); assert.deepEqual(restored.logs, []); assert.equal(restored.profile, original.local['fp.profile']); assert.equal(await page.locator('.app').getAttribute('inert'), null); assert.deepEqual(errors, [])
    } finally {await context.close()}
  })
} finally {
  await writeFile(output + '/results.json', JSON.stringify(results, null, 2) + '\n')
  await browser.close()
}
const failed = results.filter(item => item.status === 'failed')
console.log(`真实浏览器：${results.length - failed.length}/${results.length} 通过；证据 ${output}/results.json`)
if (failed.length) process.exitCode = 1
