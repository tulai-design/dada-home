import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

// 执行真实工具逻辑，隔离网络和浏览器存储；不装测试依赖、不碰用户数据。
const source = await readFile(new URL('../src/lib/siteTools.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
let workspace
let commits
let requests
let stored
const defaults = ['zhihu', 'weibo', 'ithome']
const available = ['zhihu', 'weibo', 'ithome', 'github']
class WorkspaceError extends Error {}
const dependencies = {
  '@tulai-design/agent-core': {createToolFactory: () => (schema, definition) => ({...definition, execute: (args) => definition.execute(schema.schema.parse(args), {signal: new AbortController().signal})})},
  './errors': {WorkspaceError},
  './defaults': {SEARCH_ENGINES: [], defaultSettings: () => ({proxy: '', hotSource: ''})},
  './skills': {SKILLS: []},
  './store': {readStored: () => stored, writeStored: (_key, value) => { stored = value }},
  './hot': {
    DEFAULT_HOT_BOARDS: defaults,
    fetchSources: async () => available.map((id) => ({id, name: id})),
    fetchBoards: async (_origin, ids) => { requests.push([...ids]); return ids.map((id) => ({id, name: id, items: []})) },
  },
  './workspaceStore': {getWorkspace: () => workspace, commit: (next) => { workspace = next; commits += 1 }},
  './ops': {updateComponent: (before, ref, patch) => {
    const target = before.pages.flatMap((page) => page.components).find((component) => component.id === ref)
    assert(target, '提交必须引用存在的组件')
    const instance = {...target, config: {...target.config, ...patch.config}}
    return {instance, workspace: {...before, pages: before.pages.map((page) => ({...page, components: page.components.map((component) => component.id === ref ? instance : component)}))}}
  }},
}
const module = {exports: {}}
vm.runInNewContext(compiled, {module, exports: module.exports, require: (id) => dependencies[id] ?? {}, URL, AbortController})
const tools = module.exports.SITE_TOOLS
const run = (name, args = {}) => tools.find((tool) => tool.name === name).execute(args)
const hot = (id, boards) => ({id, type: 'hot', config: {heading: `标题 ${id}`, boards, perBoard: 16}})
function reset(components) {
  workspace = {pages: [{id: 'one', name: '首页', components}]}
  commits = 0
  requests = []
  stored = {proxy: '', hotSource: '', hotBoards: ['legacy-board']}
}
const tests = []
async function test(name, fn) { await fn(); tests.push(name); console.log(`通过：${name}`) }

await test('get_hot 读取实际组件关注，忽略遗留设置', async () => {
  reset([hot('hot-one', 'github,weibo')])
  const result = await run('get_hot')
  assert.match(result, /hot-one/)
  assert.deepEqual(requests, [['github', 'weibo']])
})
await test('空关注保持为空，不用默认榜单覆盖', async () => {
  reset([hot('hot-one', '')])
  assert.match(await run('get_hot'), /还没有关注榜单/)
  assert.equal(requests.length, 0)
})
await test('set_hot_boards 提交目标实例，保留其他配置和遗留设置', async () => {
  reset([hot('first', 'zhihu'), hot('second', 'weibo')])
  assert.match(await run('set_hot_boards', {ref: 'second', boards: ['github', 'github', 'ithome']}), /second/)
  assert.equal(commits, 1)
  assert.equal(workspace.pages[0].components[0].config.boards, 'zhihu')
  assert.deepEqual(workspace.pages[0].components[1].config, {heading: '标题 second', boards: 'github,ithome', perBoard: 16})
  assert.deepEqual(stored.hotBoards, ['legacy-board'])
})
await test('多个实例未指定 ref 时 get/set 明确返回可选实例', async () => {
  reset([hot('first', 'zhihu'), hot('second', 'weibo')])
  for (const name of ['get_hot', 'set_hot_boards']) {
    await assert.rejects(() => run(name, {boards: name === 'get_hot' ? [] : ['github']}), error => /请用 ref 指定/.test(error.message) && /first/.test(error.message) && /second/.test(error.message))
  }
  assert.equal(requests.length, 0)
  assert.equal(commits, 0)
})
await test('list_hot_sources 列出每个实例的实际关注', async () => {
  reset([hot('first', 'zhihu'), hot('second', 'weibo')])
  const result = await run('list_hot_sources')
  assert.match(result, /first｜首页｜标题 first｜关注：zhihu/)
  assert.match(result, /second｜首页｜标题 second｜关注：weibo/)
  assert.doesNotMatch(result, /legacy-board/)
  assert.doesNotMatch(await run('list_hot_sources', {ref: 'second'}), /标题 first/)
})
await test('无效组件 ref 和不存在榜单不提交', async () => {
  reset([hot('first', 'zhihu')])
  await assert.rejects(() => run('set_hot_boards', {ref: 'missing', boards: ['github']}), /没有这个热榜组件/)
  await assert.rejects(() => run('set_hot_boards', {boards: ['missing']}), /这些榜单不存在/)
  assert.equal(commits, 0)
})
await test('直接指定榜单读取时不随意选择页面实例', async () => {
  reset([hot('first', 'zhihu'), hot('second', 'weibo')])
  await run('get_hot', {boards: ['github']})
  assert.deepEqual(requests, [['github']])
})
await test('未安装组件时明确默认读取与添加入口', async () => {
  reset([])
  assert.match(await run('get_hot'), /页面尚无热榜组件/)
  assert.deepEqual(requests, [defaults])
  await assert.rejects(() => run('set_hot_boards', {boards: ['github']}), /先用 add_component 添加 hot/)
  assert.equal(commits, 0)
})
console.log(`热榜工具回归全部通过：${tests.length}/${tests.length}`)
