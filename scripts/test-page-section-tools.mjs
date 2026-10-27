import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'
import * as agentCore from '@tulai-design/agent-core'

// 执行真实工具、数据校验和工作空间操作；仅隔离存储、网络与未使用的业务工具。
const root = fileURLToPath(new URL('../', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const modules = new Map()
let workspace, commits = 0
const store = {getWorkspace: () => workspace, commit: (next) => {workspace = next; commits += 1}}
const isolated = new Map([
  ['src/lib/workspaceStore.ts', store],
  ['src/lib/componentData.ts', {}], ['src/lib/browserBookmarks.ts', {}], ['src/lib/bookmarks.ts', {}], ['src/lib/persona.ts', {}],
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
const run = async (name, args = {}) => {const tool = find(name); return tools.runTool(tool, tool.parseArguments(args), {openPage: () => {throw new Error('布局工具不得导航')}})}
const base = () => ({...ops.defaultWorkspace(), pages: [{id: 'home', name: '首页', label: '首页', components: ['a', 'b', 'c', 'd'].map((id) => ({id, type: 'note', config: {heading: id}, span: 'half'}))}], addons: ['desk'], statusbar: []})
let passed = 0
async function test(name, fn) {workspace = base(); commits = 0; await fn(); passed += 1; console.log(`通过：${name}`)}

await test('AI可发现三种布局、参数和容器重排规则，读取不提交', async () => {
  const tool = find('list_page_layouts')
  assert.equal(tool.effect, 'read')
  const catalog = JSON.parse(await run('list_page_layouts'))
  assert.deepEqual(catalog.layouts.map((item) => item.kind), ['hero', 'section', 'split'])
  assert.equal(catalog.maxSections, 8)
  assert.equal(catalog.maxHero, 1)
  assert.equal(catalog.compactWidth, 720)
  assert.deepEqual(catalog, load('src/lib/pageSections.ts').PAGE_SECTION_CATALOG)
  assert.equal(commits, 0)
})

await test('AI一次设置已有组件的分区并同步阅读顺序，保留原实例', async () => {
  const original = new Map(workspace.pages[0].components.map((item) => [item.id, item]))
  const sections = [
    {id: 'hero', kind: 'hero', items: ['b'], align: 'center'},
    {id: 'work', kind: 'split', title: '工作区', primary: ['c'], secondary: ['a'], ratio: 'wide-primary'},
  ]
  const tool = find('set_page_sections')
  assert.equal(tool.effect, 'write')
  assert.equal(tool.highRisk({}), false)
  const result = await run('set_page_sections', {pageId: ' home ', sections})
  assert.match(result, /已更新/)
  assert.equal(commits, 1)
  assert.deepEqual(workspace.pages[0].sections, sections)
  assert.deepEqual(workspace.pages[0].components.map((item) => item.id), ['b', 'c', 'a', 'd'])
  for (const item of workspace.pages[0].components) assert.equal(item, original.get(item.id))
})

await test('读取工作空间披露实际分区、阅读顺序与未分组组件', async () => {
  await run('set_page_sections', {pageId: 'home', sections: [{id: 'intro', kind: 'hero', items: ['c']}, {id: 'rest', kind: 'section', items: ['b', 'a'], columns: 3}]})
  commits = 0
  const result = await run('get_workspace')
  const line = result.split('\n').find((value) => value.startsWith('  页面布局：'))
  assert.ok(line, '工作空间结果应披露可回写的分区和有效顺序')
  const layout = JSON.parse(line.slice('  页面布局：'.length))
  assert.deepEqual(layout.sections, workspace.pages[0].sections)
  assert.deepEqual(layout.effectiveOrder, ['c', 'b', 'a', 'd'])
  assert.deepEqual(layout.ungrouped, ['d'])
  assert.equal(commits, 0)
})

await test('省略必要字段不会意外清空现有结构', async () => {
  await run('set_page_sections', {pageId: 'home', sections: [{id: 'intro', kind: 'hero', items: ['b']}]})
  commits = 0
  const before = workspace
  for (const args of [{pageId: 'home'}, {pageId: 'home', sections: undefined}, {sections: []}, {pageId: ' ', sections: []}, {pageId: 2, sections: []}]) {
    await assert.rejects(run('set_page_sections', args), /pageId|sections/)
    assert.equal(workspace, before)
    assert.equal(commits, 0)
  }
})

await test('不合法结构、引用与页面被拒绝且不提交', async () => {
  const before = workspace
  const section = {id: 'content', kind: 'section', items: ['a']}
  const invalid = [
    {pageId: 'missing', sections: []},
    {pageId: 'home', sections: {}},
    {pageId: 'home', sections: [null]},
    {pageId: 'home', sections: [{...section, items: ['missing']}]},
    {pageId: 'home', sections: [{...section, items: ['a', 'a']}]},
    {pageId: 'home', sections: [section, {...section, id: 'other'}]},
    {pageId: 'home', sections: [section, {...section, items: ['b']}]},
    {pageId: 'home', sections: [{...section, columns: 4}]},
    {pageId: 'home', sections: [{...section, title: '字'.repeat(81)}]},
    {pageId: 'home', sections: [{...section, id: '分区'}]},
    {pageId: 'home', sections: [{...section, id: 'a'.repeat(49)}]},
    {pageId: 'home', sections: [{...section, css: 'width: 100vw'}]},
    {pageId: 'home', sections: [{id: 'intro', kind: 'hero', items: ['a'], align: 'end'}]},
    {pageId: 'home', sections: [{id: 'intro', kind: 'hero', items: ['a']}, {id: 'second', kind: 'hero', items: ['b']}]},
    {pageId: 'home', sections: [{id: 'work', kind: 'split', primary: ['a'], secondary: ['a']}]},
    {pageId: 'home', sections: [{id: 'work', kind: 'split', primary: ['a'], secondary: ['b'], ratio: '3:1'}]},
    {pageId: 'home', sections: [{id: 'work', kind: 'split', primary: ['a']}]},
    {pageId: 'home', sections: Array.from({length: 9}, (_, index) => ({...section, id: `s${index}`, items: []}))},
  ]
  for (const args of invalid) {
    assert.match(await run('set_page_sections', args), /没有成功/)
    assert.equal(workspace, before, `无效输入不应更新工作空间：${JSON.stringify(args)}`)
    assert.equal(commits, 0)
  }
})

await test('null和空数组都只清除结构，保持有效顺序、实例和配置', async () => {
  for (const sections of [null, []]) {
    await run('set_page_sections', {pageId: 'home', sections: [{id: 'intro', kind: 'hero', items: ['c', 'b']}]})
    const components = workspace.pages[0].components
    commits = 0
    assert.match(await run('set_page_sections', {pageId: 'home', sections}), /已更新/)
    assert.equal(commits, 1)
    assert.equal(workspace.pages[0].sections, undefined)
    assert.equal(workspace.pages[0].components, components)
    assert.deepEqual(components.map((item) => item.id), ['c', 'b', 'a', 'd'])
  }
})

await test('移动和添加沿用有效阅读顺序，末尾插入未分组区域', async () => {
  await run('set_page_sections', {pageId: 'home', sections: [{id: 'work', kind: 'split', primary: ['c'], secondary: ['a']}]})
  commits = 0
  assert.match(await run('move_component', {ref: 'b', pageId: 'home', toIndex: 1}), /已移动/)
  assert.deepEqual(workspace.pages[0].sections[0].secondary, ['b', 'a'])
  assert.deepEqual(workspace.pages[0].components.map((item) => item.id), ['c', 'b', 'a', 'd'])
  assert.equal(commits, 1)
  assert.match(await run('add_component', {pageId: 'home', type: 'note', index: 0}), /已添加/)
  const added = workspace.pages[0].components[0]
  assert.deepEqual(workspace.pages[0].sections[0].primary, [added.id, 'c'])
  await run('move_component', {ref: added.id, pageId: 'home'})
  assert.deepEqual(workspace.pages[0].sections[0].primary, ['c'])
  assert.equal(workspace.pages[0].components.at(-1).id, added.id)
  assert.equal(commits, 3)
})

console.log(`页面布局工具回归全部通过：${passed}/${passed}`)
