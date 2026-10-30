import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import * as core from '@tulai-design/agent-core'
import * as providers from '@tulai-design/agent-providers'

function compile(file, dependencies = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const module = {exports: {}}
  new Function('module', 'exports', 'require', code)(module, module.exports, (name) => dependencies[name] ?? {})
  return module.exports
}

let commits = 0
const workspace = {pages: [{id: 'home', name: '首页', components: []}, {id: 'desk', name: '书桌', components: []}]}
const store = {getWorkspace: () => workspace, commit: () => {commits += 1}}
const errors = compile('src/lib/errors.ts')
const policy = compile('src/fx/policy.ts', {'./capabilities': compile('src/fx/capabilities.ts'), '../lib/errors': errors})
const inspector = compile('src/lib/pageInspector.ts')
const tools = compile('src/lib/tools.ts', {
  '@tulai-design/agent-core': core,
  '../fx/policy': policy,
  './dock': compile('src/lib/dock.ts', {'./errors': errors}),
  './pageInspector': inspector,
  './workspaceStore': store,
  './market': {ADDONS: []}, './siteTools': {SITE_TOOLS: []}, './searchTools': {SEARCH_TOOLS: []}, './lifeTools': {LIFE_TOOLS: []}, './homepageDraftTools': {HOMEPAGE_DRAFT_TOOLS: []}, './themeAuthoringTools': {THEME_AUTHORING_TOOLS: []},
})
const tool = tools.findTool('inspect_page')
assert.ok(tool, 'AI 应有公开的 inspect_page 工具')
assert.equal(tool.effect, 'read')
assert.equal(tool.highRisk({}), false)
const report = {schemaVersion: '1', status: 'ok', page: {id: 'home'}, issues: [], unknown: []}
const signal = new AbortController().signal
const result = await tools.runTool(tool, tool.parseArguments({pageId: ' home '}), {
  openPage: () => {throw new Error('检查不得导航')}, signal,
  inspectPage: async (request, receivedSignal) => {
    assert.deepEqual(request, {pageId: 'home'})
    assert.equal(receivedSignal, signal)
    return report
  },
})
assert.deepEqual(JSON.parse(result), report)
assert.equal(commits, 0)
console.log('通过：公开只读工具传递页面与取消信号，返回可解析 JSON 且不提交工作空间')

const hostModule = compile('src/lib/pageInspectionHost.ts', {'./pageInspector': inspector})
const noPage = hostModule.createPageInspectionHost({getWorkspace: () => workspace, getMounted: () => null})
const noPageContext = {openPage: () => {throw new Error('检查不得导航')}, signal, inspectPage: noPage}
const inspect = async (args = {}, context = noPageContext) => JSON.parse(await tools.runTool(tool, tool.parseArguments(args), context))
for (const pageId of [undefined, 'desk']) {
  const measured = await inspect({pageId})
  assert.equal(measured.status, 'unavailable')
  assert.ok(measured.unknown.some((item) => item.code === 'not-mounted'))
  assert.equal(measured.settled, false)
  assert.deepEqual(measured.issues, [])
}
const unknownPage = await inspect({pageId: 'missing'})
assert.equal(unknownPage.status, 'unavailable')
assert.equal(unknownPage.page.id, 'missing')
assert.ok(unknownPage.unknown.some((item) => item.code === 'unknown-page'))
console.log('通过：默认没有页面或显式页面未挂载时报告不可测；未知页面不隐式导航')

const unavailable = await inspect({pageId: 'home'}, {signal})
assert.equal(unavailable.status, 'unavailable')
assert.equal(unavailable.page.id, 'home')
assert.ok(unavailable.unknown.some((item) => item.code === 'host-unavailable'))
assert.equal(unavailable.schemaVersion, '1')
assert.deepEqual(unavailable.issues, [])
assert.equal(JSON.parse(await tools.runTool(tool, tool.parseArguments({}), {})).unknown[0].code, 'host-unavailable')
assert.equal(commits, 0)
console.log('通过：没有检查宿主时仍返回完整 JSON 报告，不伪装已测量')

const stale = hostModule.createPageInspectionHost({
  getWorkspace: () => workspace,
  getMounted: () => ({root: {isConnected: true}, pageId: 'home', workspace: {...workspace}, revision: 'before-render'}),
})
const staleReport = await stale({pageId: 'home'})
assert.equal(staleReport.status, 'unknown')
assert.equal(staleReport.unknown[0].code, 'stale-render')
assert.equal(staleReport.theme, null)
assert.equal(staleReport.reducedMotion, null)
assert.equal(commits, 0)
console.log('通过：工作空间已变但 DOM 未提交时返回未知，不把旧页面当作最新渲染')

// 时间与渲染调度是外部边界；真实宿主等待被取消后，不应残留帧回调。
const frames = new Map()
let frameId = 0
globalThis.requestAnimationFrame = (callback) => {frames.set(++frameId, callback); return frameId}
globalThis.cancelAnimationFrame = (id) => frames.delete(id)
try {
  const controller = new AbortController()
  const pending = noPage({}, controller.signal)
  controller.abort()
  await assert.rejects(pending, {name: 'AbortError'})
  assert.equal(frames.size, 0)
  const settled = noPage({})
  for (let index = 0; index < 2; index += 1) {
    const [id, callback] = frames.entries().next().value
    frames.delete(id)
    callback(index * 16)
  }
  assert.equal((await settled).unknown[0].code, 'not-mounted')
  assert.equal(frames.size, 0)
  const timedOut = await noPage({})
  assert.equal(timedOut.status, 'unavailable')
  assert.equal(timedOut.settled, false)
  assert.equal(frames.size, 0)
} finally {
  delete globalThis.requestAnimationFrame
  delete globalThis.cancelAnimationFrame
}
console.log('通过：宿主等待两帧，取消后清理等待资源')

// 使用真实 provider/agent/tool 链路；仅隔离网络和无关的持久化模块。
const ai = compile('src/lib/ai.ts', {
  '@tulai-design/agent-core': core, '@tulai-design/agent-providers': providers,
  './aiProtocol': compile('src/lib/aiProtocol.ts'), './tools': tools,
  './workspaceStore': store, './persona': {personaPrompt: () => ''}, './skills': {skillIndex: () => ''},
  './permissions': {REMEMBERABLE: {}, setAlwaysAllowed() {}}, './defaults': {OPEN_TARGETS: []},
})
const fetch = globalThis.fetch
const requests = []
const events = []
const responses = [
  [{type: 'tool_use', id: 'inspect-1', name: 'inspect_page', input: {pageId: 'home'}}],
  [{type: 'text', text: '检查完成'}],
]
globalThis.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body))
  const content = responses.shift()
  assert.ok(content, '模型请求不能重试或失去工具结果')
  return new Response(JSON.stringify({id: 'response-1', type: 'message', role: 'assistant', content,
    stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', usage: {input_tokens: 1, output_tokens: 1},
  }), {headers: {'content-type': 'application/json'}})
}
try {
  const answer = await ai.runAgent({
    config: {baseUrl: 'https://example.invalid', model: 'claude-test', protocol: 'anthropic', apiKey: 'test-only'},
    messages: [{role: 'user', content: '检查当前页面'}], signal,
    host: {openPage: () => {throw new Error('检查不得导航')}, inspectPage: async (request, receivedSignal) => {
      assert.deepEqual(request, {pageId: 'home'})
      assert.equal(receivedSignal, signal)
      return report
    }}, onDelta() {}, onTool: (event) => events.push(event),
  })
  assert.equal(answer, '检查完成')
  assert.equal(events.length, 1)
  assert.equal(events[0].ok, true)
  assert.deepEqual(JSON.parse(events[0].text), report)
  assert.equal(requests.length, 2)
  assert.equal(commits, 0)
} finally {
  globalThis.fetch = fetch
}
console.log('通过：真实 runAgent 经 dispatchTool 保留检查宿主与取消信号，结果回灌模型且不提交历史')
