import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import * as agentCore from '@tulai-design/agent-core'
import * as providers from '@tulai-design/agent-providers'

// 执行真实工具、数据校验和工作空间操作；仅隔离存储、网络与未使用的业务工具。
const root = fileURLToPath(new URL('../', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const modules = new Map()
let workspace, commits = 0
const store = {getWorkspace: () => workspace, commit: (next) => {workspace = next; commits += 1}}
const isolated = new Map([
  ['src/lib/workspaceStore.ts', store],
  ['src/lib/skills.ts', {skillIndex: () => ''}], ['src/lib/permissions.ts', {REMEMBERABLE: {}, setAlwaysAllowed() {}}],
  ['src/lib/componentData.ts', {}], ['src/lib/browserBookmarks.ts', {}], ['src/lib/bookmarks.ts', {}], ['src/lib/persona.ts', {personaPrompt: () => ''}],
  ['src/lib/siteTools.ts', {SITE_TOOLS: []}], ['src/lib/searchTools.ts', {SEARCH_TOOLS: []}], ['src/lib/lifeTools.ts', {LIFE_TOOLS: []}],
])
function load(relative) {
  const file = path.resolve(root, relative)
  const sourcePath = path.relative(root, file)
  if (isolated.has(sourcePath)) return isolated.get(sourcePath)
  if (modules.has(file)) return modules.get(file).exports
  const module = {exports: {}}
  modules.set(file, module)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  const require = (id) => {
    if (id === '@tulai-design/agent-core') return agentCore
    if (id === '@tulai-design/agent-providers') return providers
    if (id === '@phosphor-icons/react') return new Proxy({}, {get: () => () => null})
    if (!id.startsWith('.')) return nodeRequire(id)
    const target = path.resolve(path.dirname(file), id)
    const resolved = ['', '.ts', '.tsx'].map((extension) => `${target}${extension}`).find(existsSync)
    assert.ok(resolved, `无法载入 ${id}（来自 ${sourcePath}）`)
    return load(resolved)
  }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, require)
  return module.exports
}
const registry = load('src/lib/registry.ts')
for (const type of ['clock', 'search', 'links', 'note']) {
  registry.registerComponent({type, name: type, defaultConfig: {}, configSchema: {}, defaultSpan: 'half', multiple: true, ...(type === 'clock' ? {status: () => null} : {})})
}
const ops = load('src/lib/ops.ts')
const tools = load('src/lib/tools.ts')
const find = (name) => {const tool = tools.findTool(name); assert.ok(tool, `公开工具应存在：${name}`); return tool}
const run = async (name, args = {}, context = {}) => {const tool = find(name); return tools.runTool(tool, tool.parseArguments(args), {openPage: () => {throw new Error('草稿工具不得导航')}, ...context})}
const base = () => ({...ops.defaultWorkspace(), pages: [{id: 'home', name: '首页', label: '首页', components: ['a', 'b', 'c', 'd'].map((id) => ({id, type: 'note', config: {heading: id}, span: 'half'}))}], addons: ['desk'], statusbar: []})
let passed = 0
async function test(name, fn) {workspace = base(); commits = 0; await fn(); passed += 1; console.log(`通过：${name}`)}

await test('AI可发现四类首页方向，目录读取不提交工作空间', async () => {
  const tool = find('list_homepage_recipes')
  assert.equal(tool.effect, 'read')
  const catalog = JSON.parse(await run('list_homepage_recipes'))
  assert.deepEqual(catalog.recipes.map((item) => item.id), ['minimal', 'productivity', 'editorial', 'showcase'])
  assert.equal(commits, 0)
})
await test('创建和读取草稿不提交正式首页，返回可修正的版本与组件身份', async () => {
  const before = workspace
  const draft = JSON.parse(await run('create_homepage_draft', {recipeId: 'minimal'}))
  assert.equal(draft.recipeId, 'minimal')
  assert.equal(draft.revision, 1)
  assert.equal(draft.preview.mode, 'layout-only')
  assert.deepEqual(draft.components.map((item) => item.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(JSON.parse(await run('get_homepage_draft')), draft)
  assert.equal(workspace, before)
  assert.equal(commits, 0)
  await assert.rejects(run('create_homepage_draft', {recipeId: 'showcase'}), /已有/)
  await run('discard_homepage_draft', {draftId: draft.id})
  assert.equal(JSON.parse(await run('get_homepage_draft')), null)
  assert.equal(commits, 0)
})


await test('修正草稿推进版本，旧版本/非法分区/缺字段都不会提交或丢失现有草稿', async () => {
  let draft = JSON.parse(await run('create_homepage_draft', {recipeId: 'minimal'}))
  const id = draft.id
  draft = JSON.parse(await run('update_homepage_draft', {draftId: id, expectedRevision: 1, sections: [{id: 'main', kind: 'split', primary: ['d'], secondary: ['a']}]}))
  assert.equal(draft.revision, 2)
  assert.deepEqual(draft.effectiveOrder, ['d', 'a', 'b', 'c'])
  const before = await run('get_homepage_draft')
  for (const args of [
    {draftId: id, expectedRevision: 1, sections: []},
    {draftId: id, expectedRevision: 2},
    {draftId: id, expectedRevision: 2, sections: undefined},
    {draftId: id, expectedRevision: 2, sections: [], recipeId: 'minimal'},
    {draftId: id, expectedRevision: 2, sections: [], focusId: 'a'},
    {draftId: id, expectedRevision: 2, sections: [{id: 'x', kind: 'hero', items: ['missing']}]},
    {draftId: id, expectedRevision: 2, recipeId: 'missing'},
    {draftId: id, expectedRevision: 2.1, sections: []},
    {draftId: id, expectedRevision: 2, sections: [], extra: true},
  ]) {
    await assert.rejects(run('update_homepage_draft', args))
    assert.equal(await run('get_homepage_draft'), before)
    assert.equal(commits, 0)
  }
  draft = JSON.parse(await run('update_homepage_draft', {draftId: id, expectedRevision: 2, recipeId: 'showcase', focusId: 'b'}))
  assert.equal(draft.revision, 3)
  assert.equal(draft.sections[0].items[0], 'b')
  draft = JSON.parse(await run('update_homepage_draft', {draftId: id, expectedRevision: 3, sections: null}))
  assert.deepEqual(draft.sections, [])
  assert.equal(draft.revision, 4)
  await assert.rejects(run('discard_homepage_draft', {draftId: 'wrong'}))
  assert.equal(commits, 0)
  await run('discard_homepage_draft', {draftId: id})
})

await test('应用使用最新版本且只产生一次正式提交，冲突拒绝并保留草稿', async () => {
  const draft = JSON.parse(await run('create_homepage_draft', {recipeId: 'showcase', focusId: 'c'}))
  assert.equal(find('apply_homepage_draft').highRisk({}), true)
  await assert.rejects(run('apply_homepage_draft', {draftId: draft.id}), /expectedRevision/)
  await assert.rejects(run('apply_homepage_draft', {draftId: draft.id, expectedRevision: 9}), /expectedRevision/)
  assert.equal(commits, 0)
  workspace = {...workspace, theme: {...workspace.theme, mode: 'dark'}}
  const applied = JSON.parse(await run('apply_homepage_draft', {draftId: draft.id, expectedRevision: 1}))
  assert.equal(applied.applied, true)
  assert.equal(applied.undoable, true)
  assert.equal(commits, 1)
  assert.equal(workspace.theme.mode, 'dark')
  assert.deepEqual(workspace.pages[0].components.map((item) => item.id), ['c', 'a', 'b', 'd'])
  assert.equal(JSON.parse(await run('get_homepage_draft')), null)
  await assert.rejects(run('apply_homepage_draft', {draftId: draft.id, expectedRevision: 1}), /draftId/)
  assert.equal(commits, 1)
  const conflict = JSON.parse(await run('create_homepage_draft', {recipeId: 'minimal'}))
  workspace = {...workspace, pages: workspace.pages.map((page) => ({...page, name: '刚刚改名'}))}
  assert.equal(JSON.parse(await run('get_homepage_draft')).conflict, true)
  await assert.rejects(run('apply_homepage_draft', {draftId: conflict.id, expectedRevision: 1}), /首页已变化/)
  assert.equal(commits, 1)
  assert.equal(JSON.parse(await run('get_homepage_draft')).id, conflict.id)
  await run('discard_homepage_draft', {draftId: conflict.id})
})

const inspection = load('src/lib/homepageDraftInspection.ts')
const drafts = load('src/lib/homepageDraft.ts')
await test('检查工具转发取消信号与草稿目标；无宿主不声称已测量', async () => {
  const tool = find('inspect_homepage_draft')
  assert.equal(tool.effect, 'read')
  const signal = new AbortController().signal
  const expected = inspection.unavailableHomepageDraftInspection('example', 'fixture-only', '测试宿主')
  assert.deepEqual(JSON.parse(await run('inspect_homepage_draft', {draftId: 'example'}, {
    signal, inspectHomepageDraft: async (request, received) => {
      assert.deepEqual(request, {draftId: 'example'}); assert.equal(received, signal); return expected
    },
  })), expected)
  const missingHost = JSON.parse(await run('inspect_homepage_draft', {draftId: 'example'}))
  assert.equal(missingHost.status, 'unavailable')
  assert.equal(missingHost.unknown[0].code, 'host-unavailable')
  assert.deepEqual(missingHost.coverage.measured, [])
  await assert.rejects(run('inspect_homepage_draft', {}), /draftId/)
  assert.equal(commits, 0)
})

await test('真实检查宿主区分未知、未挂载和陈旧草稿，不导航也不改正式历史', async () => {
  const inspect = inspection.createHomepageDraftInspectionHost({getMounted: () => null})
  const absent = await inspect({draftId: 'gone'})
  assert.equal(absent.unknown[0].code, 'unknown-draft')
  assert.equal(absent.target.revision, null)
  assert.deepEqual(absent.coverage.measured, [])
  const draft = drafts.createHomepageDraft({recipeId: 'minimal'})
  const unmounted = await inspect({draftId: draft.id})
  assert.equal(unmounted.unknown[0].code, 'not-mounted')
  assert.equal(unmounted.target.revision, 1)
  assert.equal(unmounted.unknown.filter((item) => item.componentId).length, 4)
  assert.ok(unmounted.unknown.filter((item) => item.componentId).every((item) => item.selector.startsWith('[data-homepage-draft="')))
  const stale = inspection.createHomepageDraftInspectionHost({getMounted: () => ({root: {isConnected: true}, pageId: 'home', workspace, draftId: draft.id, revision: '1'})})
  const report = await stale({draftId: draft.id})
  assert.equal(report.status, 'unknown')
  assert.ok(report.unknown.some((item) => item.code === 'stale-render'))
  assert.deepEqual(report.coverage.measured, [])
  drafts.discardHomepageDraft({draftId: draft.id})
  assert.equal(commits, 0)
})

// 帧调度与 DOM 是外部边界；用有界帧队列验证取消、版本竞争与真实 selector 输出。
await test('检查等待后重新核对草稿版本，取消释放帧，测量结果限定草稿根并披露未知内容', async () => {
  const frames = new Map(); let nextFrame = 0
  globalThis.requestAnimationFrame = (callback) => {frames.set(++nextFrame, callback); return nextFrame}
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  const flush = () => {for (let index = 0; index < 2; index += 1) {const [id, callback] = frames.entries().next().value; frames.delete(id); callback(index * 16)}}
  try {
    const draft = drafts.createHomepageDraft({recipeId: 'minimal'})
    const noPage = inspection.createHomepageDraftInspectionHost({getMounted: () => null})
    const controller = new AbortController()
    const aborted = noPage({draftId: draft.id}, controller.signal)
    controller.abort()
    await assert.rejects(aborted, {name: 'AbortError'})
    assert.equal(frames.size, 0)
    const changed = noPage({draftId: draft.id})
    drafts.updateHomepageDraft({draftId: draft.id, expectedRevision: 1, sections: []})
    flush()
    const old = await changed
    assert.equal(old.status, 'unknown')
    assert.equal(old.unknown[0].code, 'stale-draft')
    assert.equal(old.target.revision, 1)
    assert.deepEqual(old.coverage.measured, [])
    const rect = {left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500}
    const root = {isConnected: true, parentElement: null, clientWidth: 500, clientHeight: 500, clientLeft: 0, clientTop: 0, scrollWidth: 700, scrollHeight: 500,
      getBoundingClientRect: () => rect, getClientRects: () => [rect], querySelectorAll: () => [],
      ownerDocument: {visibilityState: 'visible', documentElement: {dataset: {theme: 'dark'}}, defaultView: {getComputedStyle: () => ({display: 'block', visibility: 'visible', contentVisibility: 'visible'}), matchMedia: () => ({matches: true})}},
      get textContent() {throw new Error('检查不得读取文本')}, get innerHTML() {throw new Error('检查不得读取HTML')},
    }
    const current = drafts.getHomepageDraft()
    const mounted = {root, pageId: 'home', workspace: drafts.getHomepageDraftWorkspace(), draftId: current.id, revision: String(current.revision)}
    const inspect = inspection.createHomepageDraftInspectionHost({getMounted: () => mounted})
    const pending = inspect({draftId: current.id})
    flush()
    const report = await pending
    assert.equal(report.status, 'ok')
    assert.equal(report.target.revision, 2)
    assert.equal(report.theme, 'dark')
    assert.equal(report.page.viewport.width, 500)
    assert.equal(report.issues[0].code, 'horizontal-overflow')
    assert.equal(report.issues[0].selector, `[data-homepage-draft="${current.id}"][data-page-id="home"]`)
    assert.ok(report.unknown.some((item) => item.code === 'layout-preview-only'))
    assert.equal(report.coverage.mode, 'layout-only')
    assert.equal(report.coverage.measured.length, 2)
    assert.equal(commits, 0)
    drafts.discardHomepageDraft({draftId: current.id})
  } finally {delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame}
})


await test('真实模型工具分发保留草稿检查宿主，应用审批拒绝不执行、允许只提交一次', async () => {
  const ai = load('src/lib/ai.ts')
  const fetch = globalThis.fetch
  const signal = new AbortController().signal
  const draft = drafts.createHomepageDraft({recipeId: 'showcase', focusId: 'd'})
  const report = inspection.unavailableHomepageDraftInspection(draft.id, 'fixture-no-dom', '模型链路回归只验证宿主转发', draft.revision)
  const invoke = async (name, input, extra = {}) => {
    const requests = [], events = []
    const responses = [
      [{type: 'tool_use', id: 'draft-call', name, input}],
      [{type: 'text', text: '处理完成'}],
    ]
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body))
      const content = responses.shift()
      assert.ok(content, '工具结果不丢失、不重复请求')
      return new Response(JSON.stringify({id: 'response-1', type: 'message', role: 'assistant', content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}), {headers: {'content-type': 'application/json'}})
    }
    const answer = await ai.runAgent({
      config: {baseUrl: 'https://example.invalid', model: 'claude-test', protocol: 'anthropic', apiKey: 'fixture-only'},
      messages: [{role: 'user', content: '处理首页草稿'}], signal,
      host: {openPage: () => {throw new Error('草稿工具不得导航')}, inspectHomepageDraft: async (request, received) => {
        assert.deepEqual(request, {draftId: draft.id}); assert.equal(received, signal); return report
      }}, onDelta() {}, onTool: (event) => events.push(event), ...extra,
    })
    assert.equal(answer, '处理完成')
    assert.equal(requests.length, 2)
    assert.equal(events.length, 1)
    return {requests, event: events[0]}
  }
  try {
    const inspected = await invoke('inspect_homepage_draft', {draftId: draft.id})
    assert.equal(inspected.event.ok, true)
    assert.deepEqual(JSON.parse(inspected.event.text), report)
    assert.equal(commits, 0)
    let approvals = 0
    const args = {draftId: draft.id, expectedRevision: 1}
    const denied = await invoke('apply_homepage_draft', args, {onApproval: () => {approvals += 1; return false}})
    assert.equal(approvals, 1)
    assert.equal(denied.event.ok, false)
    assert.equal(commits, 0)
    assert.equal(drafts.getHomepageDraft().id, draft.id)
    const allowed = await invoke('apply_homepage_draft', args, {onApproval: () => {approvals += 1; return true}})
    assert.equal(approvals, 2)
    assert.equal(allowed.event.ok, true)
    assert.equal(JSON.parse(allowed.event.text).applied, true)
    assert.equal(commits, 1)
    assert.equal(drafts.getHomepageDraft(), null)
  } finally {globalThis.fetch = fetch}
})
console.log(`首页草稿工具回归：${passed}/${passed}`)
