import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/lib/extensionCloseGuard.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
function runtime({extension = true} = {}) {
  const state = {application: false, chat: false, component: false, errors: [], failed: false, saves: 0}
  const listeners = []
  const module = {exports: {}}
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: name => ({
      './applicationData': {hasPendingApplicationWrites: () => state.application},
      './chat': {hasPendingChatWrites: () => state.chat},
      './componentData': {hasPendingComponentWrites: () => state.component},
      './persistence': {getPersistenceStatus: () => ({errors: state.errors})},
      './platform': {isExtension: () => extension},
      './storageCommit': {saveBarrier: () => {state.saves++; return state.failed ? Promise.reject(new Error('保存失败')) : Promise.resolve()}},
    })[name],
    window: {addEventListener: (name, listener) => {assert.equal(name, 'beforeunload'); listeners.push(listener)}},
  })
  const close = () => {
    const event = {prevented: false, returnValue: undefined, preventDefault() {this.prevented = true}}
    listeners.forEach(listener => listener(event))
    return event
  }
  module.exports.installExtensionCloseGuard()
  return {state, close, listeners, install: module.exports.installExtensionCloseGuard}
}
let count = 0
async function test(name, work) {await work(); count++; console.log(`通过：${name}`)}
await test('没有未保存写入时不阻止关闭，不发多余保存', () => {
  const h = runtime()
  assert.equal(h.close().prevented, false)
  assert.equal(h.state.saves, 0)
  h.install()
  assert.equal(h.listeners.length, 1)
})
await test('组件、聊天和应用各自待保存时提示并启动保存，完成后可正常关闭', () => {
  for (const key of ['component', 'chat', 'application']) {
    const h = runtime(); h.state[key] = true
    const event = h.close()
    assert.equal(event.prevented, true)
    assert.equal(event.returnValue, '')
    assert.equal(h.state.saves, 1)
    h.state[key] = false
    assert.equal(h.close().prevented, false)
  }
})
await test('阻塞保存故障仍提示，重试失败不制造未处理拒绝', async () => {
  const h = runtime()
  h.state.failed = true
  h.state.errors = [{blocking: true, source: 'application-write:applet:fixture'}]
  assert.equal(h.close().prevented, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.state.saves, 1)
})
await test('已保存同步重载与非阻塞读取提示不妨碍关闭，Web版不安装监听', () => {
  const h = runtime()
  h.state.errors = [{blocking: true, source: 'sync-reload'}, {blocking: false, source: 'legacy-data'}]
  assert.equal(h.close().prevented, false)
  const web = runtime({extension: false})
  assert.equal(web.listeners.length, 0)
})
console.log(`扩展关闭保护回归全部通过：${count}/${count}`)
