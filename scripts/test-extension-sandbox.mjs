import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const helperSource = ts.transpileModule(readFileSync(new URL('../src/lib/extensionSandbox.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
function helper(extension) {
  const module = {exports: {}}
  vm.runInNewContext(helperSource, {module, exports: module.exports, require: () => ({isExtension: () => extension}), URL, window: {location: {href: 'chrome-extension://fixture/index.html'}}})
  return module.exports.sandboxFrameProps
}
let afterLoad = 0
const document = '<!doctype html><html><body>完整应用文档</body></html>'
const web = helper(false)(document, 'session-a', () => {afterLoad++})
assert.equal(web.srcDoc, document)
assert.equal(web.src, undefined)
web.onLoad()
assert.equal(afterLoad, 1)

const sent = []
const extension = helper(true)(document, 'session-a', () => {afterLoad++})
assert.equal(extension.srcDoc, undefined)
assert.equal(extension.src, 'chrome-extension://fixture/sandbox.html')
extension.onLoad({currentTarget: {contentWindow: {postMessage: (...args) => sent.push(args)}}})
assert.deepEqual(JSON.parse(JSON.stringify(sent)), [[{dadaSandbox: 1, session: 'session-a', document}, '*']])
assert.equal(afterLoad, 2)

// 执行真正的 bootstrap：只有直接父窗口的完整引导消息可以替换文档。
const listeners = new Set(), writes = [], parent = {}
vm.runInNewContext(readFileSync(new URL('../browser-extension/sandbox.js', import.meta.url), 'utf8'), {
  parent,
  addEventListener: (name, listener) => {assert.equal(name, 'message'); listeners.add(listener)},
  removeEventListener: (name, listener) => {assert.equal(name, 'message'); listeners.delete(listener)},
  document: {open: () => writes.push('open'), write: value => writes.push(value), close: () => writes.push('close')},
})
const dispatch = (data, source = parent) => [...listeners].forEach(listener => listener({data, source}))
const message = {dadaSandbox: 1, session: 'session-a', document}
dispatch(message, {})
dispatch({...message, session: ''})
dispatch({...message, document: {html: document}})
dispatch({tada: 1, session: 'session-a', op: 'set'})
assert.deepEqual(writes, [])
dispatch(message)
assert.deepEqual(writes, ['open', document, 'close'])
dispatch({...message, document: '第二份文档不得替换当前运行程序'})
assert.equal(writes.length, 3)
assert.equal(listeners.size, 0)
console.log('扩展沙盒回归通过：Web 文档不变、扩展包内引导、父来源限制、单次初始化。')
