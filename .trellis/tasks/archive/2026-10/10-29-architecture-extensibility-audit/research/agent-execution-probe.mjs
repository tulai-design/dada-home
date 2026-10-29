// 从仓库根目录执行。只运行真实编排/guard源码，所有外部依赖与写操作均为隔离替身。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'

const require = createRequire(`${process.cwd()}/package.json`)
const ts = require('typescript')
const compiled = ts.transpileModule(fs.readFileSync('src/lib/ai.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText
const toolsSource = fs.readFileSync('src/lib/tools.ts', 'utf8')
const ast = ts.createSourceFile('tools.ts', toolsSource, ts.ScriptTarget.Latest, true)
const guardSource = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'guard').getText(ast)
class WorkspaceError extends Error {}
const guard = new Function('WorkspaceError', ts.transpile(guardSource, {target: ts.ScriptTarget.ES2022}) + ';return guard')(WorkspaceError)
const tick = () => new Promise(resolve => setImmediate(resolve))

function runner({approval = false, execute}) {
  const module = {exports: {}}
  let requests = 0
  const tool = {name: 'audit_fixture', title: '隔离探针'}
  const provider = async () => ++requests === 1
    ? {ok: true, content: '', toolCalls: [{id: 'fixture', function: {name: tool.name, arguments: '{}'}}]}
    : {ok: true, content: '结束'}
  const deps = {
    '@tulai-design/agent-core': {requiresToolApproval: () => approval, validateToolInput: () => ({args: {}})},
    '@tulai-design/agent-providers': {streamChatCompletions: provider},
    './tools': {findTool: () => tool, toolSchemas: () => [{function: {name: tool.name}}], runTool: execute},
    './aiProtocol': {resolveAiProtocol: () => 'openai'},
    './skills': {skillIndex: () => ''}, './persona': {personaPrompt: () => ''},
    './permissions': {REMEMBERABLE: {}},
  }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, require: id => deps[id] ?? {}, AbortController,
    fetch: () => {throw new Error('探针不允许网络请求')},
  })
  return module.exports.runAgent
}

const config = {baseUrl: 'https://fixture.invalid', model: 'fixture', maxRounds: 2}
let release, reached
const gate = new Promise(resolve => {reached = resolve})
let writes = 0, ended = false
const controller = new AbortController()
const run = runner({approval: true, execute: async () => {writes++; return 'fixture saved'}})({
  config, messages: [], host: {}, signal: controller.signal, onDelta() {}, onTool() {},
  onApproval: () => {reached(); return new Promise(resolve => {release = resolve})},
}).then(() => {ended = true})
await gate
controller.abort()
await tick()
assert.equal(ended, false)
console.log(JSON.stringify({probe: 'abort_pending_approval', signalAborted: controller.signal.aborted, runEnded: ended, writes}))
release(true)
await run
assert.equal(writes, 1)
console.log(JSON.stringify({probe: 'approve_after_abort', runEnded: ended, writes}))

const events = []
await runner({execute: () => guard(() => {throw new WorkspaceError('页面不存在')})})({
  config, messages: [], host: {}, onDelta() {}, onTool: event => events.push(event),
})
assert.equal(events[0].ok, true)
assert.equal(events[0].text, '没有成功：页面不存在')
console.log(JSON.stringify({probe: 'domain_error_event', ok: events[0].ok, text: events[0].text}))
