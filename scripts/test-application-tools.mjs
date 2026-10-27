import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 执行真实应用目录、工具、组件注册和沙盒 SDK，隔离用户存储、网络及 React 渲染。
const modules = new Map()
const core = new Set(['workspace', 'fonts', 'errors', 'registry', 'applications', 'dock', 'pageSections'])
function compile(file, dependencies = {}, globals = {}) {
  const module = {exports: {}}
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  vm.runInNewContext(compiled, {module, exports: module.exports, require: (id) => dependencies[id] ?? {}, ...globals})
  return module.exports
}
function loadCore(name) {
  if (modules.has(name)) return modules.get(name)
  const dependencies = Object.fromEntries([...core].filter((key) => key !== name).map((key) => [`./${key}`, new Proxy({}, {get: (_, property) => loadCore(key)[property]})]))
  const result = compile(`src/lib/${name}.ts`, dependencies)
  modules.set(name, result)
  return result
}
const registry = loadCore('registry')
const appModule = compile('src/widgets/app.tsx', {'../lib/registry': registry}, {document: {documentElement: {}}, getComputedStyle: () => ({getPropertyValue: () => ''})})
compile('src/widgets/applet.tsx', {'../lib/registry': registry})
const catalog = compile('src/lib/applet/catalog.ts')
const runner = compile('src/lib/applet/runner.ts', {'./catalog': catalog})
const applications = loadCore('applications')
const model = loadCore('workspace')
const fxPolicy = compile('src/fx/policy.ts', {'./capabilities': compile('src/fx/capabilities.ts'), '../lib/errors': loadCore('errors')})
let workspace, commits, opens
const dependencies = {
  '@tulai-design/agent-core': {createToolFactory: () => (schema, definition) => ({...definition, parameters: schema.json, parseArguments: schema.schema.parse})},
  './errors': loadCore('errors'), './workspace': model, './registry': registry, './applications': applications,
  './dock': loadCore('dock'), './pageSections': loadCore('pageSections'),
  '../fx/policy': fxPolicy,
  './workspaceStore': {getWorkspace: () => workspace, commit: (next) => {workspace = next; commits += 1}},
  './market': {ADDONS: []}, './siteTools': {SITE_TOOLS: []}, './searchTools': {SEARCH_TOOLS: []}, './lifeTools': {LIFE_TOOLS: []}, './homepageDraftTools': {HOMEPAGE_DRAFT_TOOLS: []},
}
const {HOME_TOOLS} = compile('src/lib/tools.ts', dependencies)
const tool = (name) => HOME_TOOLS.find((item) => item.name === name)
const run = (name, args = {}, context = {openApplication: (id, mode) => opens.push({id, mode})}) => tool(name).execute(tool(name).parseArguments(args), context)
const plain = (value) => JSON.parse(JSON.stringify(value))
let count = 0
async function test(name, fn) {
  workspace = {pages: [{id: 'home', name: '首页', components: []}], applications: [], statusbar: []}
  commits = 0; opens = []
  await fn(); count += 1; console.log(`通过：${name}`)
}
const source = 'applet({state:{}, view:(_,ctx)=>ui.Text({text:String(ctx.settings.minutes)})})'
const settingsSchema = {minutes: {kind: 'number', label: '分钟', default: 25, min: 1, max: 120}, sound: {kind: 'boolean', label: '声音', default: true}}

await test('AI创建应用默认只安装到市场，分组与设置保留，不新建页面或固定入口', async () => {
  assert.match(await run('create_applet', {title: '番茄助手', source, group: '效率', settingsSchema}), /已安装小程序/)
  assert.equal(workspace.pages.length, 1)
  assert.equal(workspace.pages[0].components.length, 0)
  const app = workspace.applications[0]
  assert.equal(app.group, '效率'); assert.equal(app.dock, false); assert.equal(app.status, false); assert.equal(app.openMode, 'modal')
  assert.deepEqual(plain(app.settings), {minutes: 25, sound: true})
  assert.equal(commits, 1)
})
await test('AI可选pageId挂载同一id，移动及取消小组件不卸载应用', async () => {
  await run('create_app', {title: '画板', html: '<canvas/>', pageId: 'home', span: 'full'})
  const id = workspace.applications[0].id
  assert.equal(workspace.pages[0].components[0].id, id)
  assert.equal(workspace.pages[0].components[0].span, 'full')
  await run('mount_application', {ref: id, pageId: null})
  assert.equal(workspace.pages[0].components.length, 0)
  assert.equal(workspace.applications.length, 1)
})
await test('页面不存在或配置不合法时，创建/配置原子失败且不提交', async () => {
  assert.match(await run('create_applet', {source, pageId: 'missing'}), /没有成功/)
  assert.equal(commits, 0); assert.equal(workspace.applications.length, 0)
  await run('create_applet', {source, settingsSchema})
  const before = JSON.stringify(workspace), id = workspace.applications[0].id
  assert.match(await run('configure_application', {ref: id, openMode: 'invalid'}), /没有成功/)
  assert.match(await run('configure_application', {ref: id, settings: {sound: 'yes'}}), /没有成功/)
  assert.equal(JSON.stringify(workspace), before); assert.equal(commits, 1)
  assert.throws(() => tool('configure_application').parseArguments({dock: 'yes'}), /布尔/)
})
await test('未挂页面的小程序可更新源码/分组/入口，用户设置按字段合并', async () => {
  await run('create_applet', {title: '工具', source, settingsSchema, group: '生活'})
  const id = workspace.applications[0].id
  await run('update_applet', {ref: id, source: source + '\n// 更新', group: '效率'})
  await run('configure_application', {ref: id, dock: true, status: true, openMode: 'drawer', settings: {minutes: 35}})
  const app = workspace.applications[0]
  assert.equal(app.instance.config.source, source + '\n// 更新'); assert.equal(app.group, '效率')
  assert.equal(app.dock, true); assert.equal(app.status, true); assert.equal(app.openMode, 'drawer')
  assert.deepEqual(plain(app.settings), {minutes: 35, sound: true})
  await run('configure_application', {ref: id, group: ''})
  assert.equal(workspace.applications[0].group, '')
})
await test('状态栏支持显式compact并注入status形态，无效模式不提交', async () => {
  for (const name of ['create_app', 'create_applet', 'update_app', 'update_applet', 'configure_application']) {
    assert.deepEqual(plain(tool(name).parameters.properties.statusMode.enum), ['launcher', 'compact'])
  }
  await run('create_applet', {source: 'applet({view:(_,ctx)=>ui.Text({text:ctx.surface==="status"?"25m":"完整工具"})})', status: true, statusMode: 'compact'})
  const id = workspace.applications[0].id
  assert.equal(workspace.applications[0].statusMode, 'compact')
  const config = registry.normalizeConfig(registry.getDefinition('applet'), applications.applicationInstance(workspace, id, 'status').config)
  assert.equal(config.surface, 'status')
  const before = JSON.stringify(workspace), previous = commits
  assert.match(await run('configure_application', {ref: id, statusMode: 'background'}), /没有成功/)
  assert.equal(JSON.stringify(workspace), before); assert.equal(commits, previous)
  await run('configure_application', {ref: id, statusMode: 'launcher'})
  assert.equal(workspace.applications[0].statusMode, 'launcher')
})
await test('未挂页面的HTML应用可部分更新，错误类型不修改另一个应用', async () => {
  await run('create_app', {title: '画板', html: '<canvas/>', css: 'canvas{width:100%}', js: 'const value=1'})
  const id = workspace.applications[0].id
  await run('update_app', {ref: id, js: 'const value=2', description: '新的说明'})
  assert.equal(workspace.applications[0].instance.config.html, '<canvas/>')
  assert.equal(workspace.applications[0].instance.config.js, 'const value=2')
  const before = JSON.stringify(workspace)
  assert.match(await run('update_applet', {ref: id, source}), /不是小程序/)
  assert.equal(JSON.stringify(workspace), before)
})
await test('应用列表包含设置入口与挂载来源，可省略源码；打开视图不提交配置', async () => {
  await run('create_applet', {title: '工具', source, settingsSchema, group: '效率', pageId: 'home'})
  const id = workspace.applications[0].id, before = commits
  const full = JSON.parse(await run('list_applications', {ref: id}))
  assert.equal(full[0].instance.config.source, source)
  assert.equal(full[0].settingsSection, `application:${id}`)
  assert.equal(full[0].mountedPages[0].id, 'home')
  assert.equal(JSON.parse(await run('list_applications', {includeSource: false}))[0].instance.config, undefined)
  await run('open_application', {ref: '工具', mode: 'page'})
  assert.deepEqual(opens, [{id, mode: 'page'}]); assert.equal(commits, before)
  assert.match(await run('open_application', {ref: id, mode: 'invalid'}), /没有成功/)
})
await test('卸载标记高危，移除目录和所有入口挂载，不触碰私有存储', async () => {
  await run('create_applet', {source, pageId: 'home', dock: true, status: true})
  assert.equal(tool('uninstall_application').highRisk(), true)
  await run('uninstall_application', {ref: workspace.applications[0].id})
  assert.equal(workspace.applications.length, 0); assert.equal(workspace.pages[0].components.length, 0)
})
await test('真实组件schema保留注入设置与surface，源码更新不能伪造宿主上下文', async () => {
  await run('create_applet', {source, settingsSchema})
  const id = workspace.applications[0].id
  const instance = applications.applicationInstance(workspace, id, 'drawer')
  const config = registry.normalizeConfig(registry.getDefinition('applet'), instance.config)
  assert.equal(config.surface, 'drawer'); assert.deepEqual(plain(config.settings), {minutes: 25, sound: true})
  const changed = applications.updateApplication(workspace, id, {config: {surface: 'fake', settings: {minutes: 99}}}).application
  assert.equal(changed.instance.config.surface, undefined); assert.equal(changed.instance.config.settings, undefined)
})
await test('HTML应用安全注入只读设置与surface，设置中的script标签不逃逸', () => {
  const value = '</script><script>window.escaped=true</script>$&$$$`$\''
  const doc = appModule.buildSrcdoc({html: '<p>应用</p>', css: '', js: '', height: 320, settings: {text: value}, surface: 'status'}, [], false)
  const sdk = doc.match(/<script>([\s\S]*?)<\/script>/)[1]
  const scope = {parent: {postMessage() {}}, addEventListener() {}, setTimeout() {}, navigator: {}, document: {documentElement: {dataset: {theme: 'light'}}}}
  scope.window = scope
  vm.runInNewContext(sdk, scope)
  assert.equal(scope.window.tada.settings.text, value)
  assert.equal(scope.window.tada.surface, 'status')
  assert.equal(Object.isFrozen(scope.window.tada.settings), true)
  assert.equal(scope.window.escaped, undefined)
})
await test('小程序设置/surface热更新保留persist状态，ctx设置只读', async () => {
  const messages = [], listeners = {}, queued = []
  const scope = {parent: {postMessage: (message) => messages.push(message)}, addEventListener: (name, fn) => {listeners[name] = fn}, setTimeout: (fn) => {queued.push(fn)}, setInterval() {}, clearInterval() {}, clearTimeout() {}, navigator: {}}
  scope.window = scope
  const script = runner.buildRunnerDoc('').match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInNewContext(script, scope)
  vm.runInNewContext('applet({state:{count:0},persist:["count"],view:(s,ctx)=>ui.Text({text:s.count+":"+ctx.settings.minutes+":"+ctx.surface})})', scope)
  await listeners.message({data: {applet: 1, k: 'init', saved: {count: 7}, settings: {minutes: 25}, surface: 'modal'}})
  assert.equal(messages.filter((item) => item.k === 'view').at(-1).tree.p.text, '7:25:modal')
  await listeners.message({data: {applet: 1, k: 'context', settings: {minutes: 35}, surface: 'drawer'}})
  queued.splice(0).forEach((fn) => fn())
  assert.equal(messages.filter((item) => item.k === 'view').at(-1).tree.p.text, '7:35:drawer')
  await listeners.message({data: {applet: 1, k: 'context', settings: {minutes: 35}, surface: 'status'}})
  queued.splice(0).forEach((fn) => fn())
  assert.equal(messages.filter((item) => item.k === 'view').at(-1).tree.p.text, '7:35:status')
  assert.equal(messages.filter((item) => item.k === 'save').length, 0)
})
console.log(`AI应用工具与运行时回归全部通过：${count}/${count}`)
