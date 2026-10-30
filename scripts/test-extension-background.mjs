import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../browser-extension/background.js', import.meta.url), 'utf8').replace("import {handle} from './handlers.js'", 'const handle=async()=>({items:[]})')
const base = 'chrome-extension://fixture/'
function harness() {
  const session = {}, tabs = new Map([[10, {id: 10, windowId: 1, url: base + 'index.html'}], [20, {id: 20, windowId: 2, url: base + 'index.html'}]])
  const focused = [], windows = [], opened = []
  function worker() {
    let message, action
    const chrome = {
      runtime: {id: 'fixture', getURL: path => base + path, onMessage: {addListener: listener => {message = listener}}},
      action: {onClicked: {addListener: listener => {action = listener}}},
      storage: {session: {
        get: async key => ({[key]: session[key]}),
        set: async values => Object.assign(session, values),
        remove: async key => {delete session[key]},
      }},
      tabs: {
        get: async id => {if (!tabs.has(id)) throw new Error('不存在的标签页'); return tabs.get(id)},
        update: async id => {focused.push(id)},
        create: async tab => {opened.push(tab)},
      },
      windows: {update: async id => {windows.push(id)}},
    }
    vm.runInNewContext(source, {chrome, URL, console})
    return {
      send: (payload, sender = {id: 'fixture', url: base + 'index.html'}) => new Promise(resolve => {
        if (!message(payload, sender, resolve)) resolve(undefined)
      }),
      action: () => action(),
    }
  }
  return {worker, session, tabs, focused, windows, opened}
}
let count = 0
async function test(name, work) {await work(); count++; console.log(`通过：${name}`)}
await test('SW重启后从session恢复持锁主页，不按等待标签页顺序定位', async () => {
  const h = harness(), first = h.worker()
  assert.equal((await first.send({op: 'register-workspace', tabId: 10})).ok, true)
  const restarted = h.worker()
  assert.equal((await restarted.send({op: 'focus-workspace'})).ok, true)
  assert.deepEqual(h.focused, [10])
  assert.deepEqual(h.windows, [1])
  await restarted.action()
  assert.deepEqual(h.focused, [10, 10])
})
await test('已关闭的owner不定位等待页；新owner注册后精确定位', async () => {
  const h = harness(), worker = h.worker()
  await worker.send({op: 'register-workspace', tabId: 10})
  h.tabs.delete(10)
  const reply = await h.worker().send({op: 'focus-workspace'})
  assert.equal(reply.ok, false)
  assert.deepEqual(h.focused, [])
  await worker.send({op: 'register-workspace', tabId: 20})
  await h.worker().send({op: 'focus-workspace'})
  assert.deepEqual(h.focused, [20])
})
await test('非扩展来源不能登记或调用书签，登记目标也必须为当前扩展主页', async () => {
  const h = harness(), worker = h.worker()
  assert.equal(await worker.send({op: 'register-workspace', tabId: 10}, {id: 'fixture', url: 'https://example.test/'}), undefined)
  assert.equal(await worker.send({source: 'dada-extension', op: 'list'}, {id: 'foreign', url: base + 'index.html'}), undefined)
  h.tabs.set(30, {id: 30, windowId: 3, url: 'https://example.test/'})
  assert.equal((await worker.send({op: 'register-workspace', tabId: 30})).ok, false)
  assert.deepEqual(h.session, {})
})
await test('无登记实例时工具栏打开新主页，不把任意等待页当持锁实例', async () => {
  const h = harness()
  await h.worker().action()
  assert.equal(h.opened[0].url, base + 'index.html')
  assert.deepEqual(h.focused, [])
})
console.log(`扩展后台回归全部通过：${count}/${count}`)
