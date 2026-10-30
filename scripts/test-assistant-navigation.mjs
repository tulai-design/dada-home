import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 提取并执行 App 的真实回调；仅替换 React setter 和外部数据源，不加载浏览器或用户存储。
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const declarations = new Map()
const visit = (node) => {
  if (ts.isVariableDeclaration(node)) {
    if (ts.isIdentifier(node.name)) declarations.set(node.name.text, node)
    else if (ts.isArrayBindingPattern(node.name)) {
      for (const item of node.name.elements) {
        if (ts.isBindingElement(item) && ts.isIdentifier(item.name)) declarations.set(item.name.text, node)
      }
    }
  }
  ts.forEachChild(node, visit)
}
visit(ast)

function callbackJs(name) {
  const declaration = declarations.get(name)
  assert.ok(declaration && ts.isCallExpression(declaration.initializer), `App 缺少 ${name} 回调`)
  assert.equal(declaration.initializer.expression.getText(ast), 'useCallback')
  return ts.transpileModule(`const ${name} = ${declaration.initializer.arguments[0].getText(ast)}`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText
}
function storedDefault(name) {
  const call = declarations.get(name)?.initializer
  assert.ok(call && ts.isCallExpression(call), `App 缺少 ${name} 偏好`)
  assert.equal(call.expression.getText(ast), 'useStored')
  assert.ok(ts.isStringLiteral(call.arguments[1]), `${name} 应有明确的默认值`)
  return call.arguments[1].text
}
function compile(file, dependencies = {}) {
  const module = {exports: {}}
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(code, {module, exports: module.exports, require: (id) => dependencies[id] ?? {}})
  return module.exports
}
function evaluate(node, scope) {
  assert.ok(node, '需要执行真实源码表达式')
  const code = ts.transpileModule(`const value = (${node.getText(ast)})`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText
  return new Function(...Object.keys(scope), `${code}; return value`)(...Object.values(scope))
}
function findNode(predicate) {
  let found
  const search = (node) => {
    if (!found && predicate(node)) found = node
    if (!found) ts.forEachChild(node, search)
  }
  search(ast)
  return found
}

const {normalizeAssistantMode} = compile('src/lib/assistantLayout.ts')
const assistantNames = ['changeAssistantMode', 'openAssistant', 'openAssistantPanel']
const assistantJs = assistantNames.map(callbackJs).join('\n')
const navigation = compile('src/lib/shell/navigation.ts')
let activeWorkspace
const navigationApi = compile('src/lib/useNavigation.ts', {
  react: {}, './market': {isInstalled: () => true}, './workspaceStore': {getWorkspace: () => activeWorkspace}, './shell/navigation': navigation,
})
function makeNavigation({split = false, sidebarAi = storedDefault('sidebarAi'), panelMode = storedDefault('panelMode')} = {}) {
  const state = {...navigationApi.initialNavigation('home'), assistantOpen: true, assistantMode: 'drawer', panelMode, sidebarAi, reader: {title: '文章'}, pendingPage: null}
  state.applicationView = {id: 'old', mode: 'modal'}
  const writes = []
  const errors = []
  const splitActiveRef = {current: split}
  const viewRef = {current: state.view}
  const applicationViewRef = {current: state.applicationView}
  const applicationMinimizedRef = {current: false}
  const applicationReturnView = {current: 'market'}
  const set = (key) => (value) => {writes.push({key, value}); state[key] = typeof value === 'function' ? value(state[key]) : value}
  const workspace = {pages: [{id: 'home', name: '首页'}, {id: 'reading', name: '阅读'}], applications: [{id: 'notes', openMode: 'drawer', instance: {title: '笔记'}}, {id: 'counter', openMode: 'modal', instance: {title: '计数'}}]}
  const sync = () => {viewRef.current = state.view; applicationViewRef.current = state.applicationView; applicationMinimizedRef.current = state.applicationMinimized; applicationReturnView.current = state.applicationReturnView}
  const navigate = target => {
    const result = navigationApi.executeNavigation({...state, view: viewRef.current}, workspace, target, {monitorInstalled: true, splitActive: splitActiveRef.current})
    if (!result.ok) {errors.push(result.reason); return result}
    for (const [key, value] of Object.entries(result.state)) if (value !== state[key]) set(key)(value)
    if (result.clearReader) set('reader')(null)
    if (result.closeAssistant) set('assistantOpen')(false)
    sync()
    return {ok: true}
  }
  const base = {
    navigate,
    goPage: id => navigate({kind: 'page', id}),
    openSettings: section => navigate({kind: 'system', name: 'settings', ...(section ? {section} : {})}),
    openMonitor: () => navigate({kind: 'system', name: 'monitor'}),
    openMarket: () => navigate({kind: 'system', name: 'market'}),
    openApplication: (id, mode) => navigate({kind: 'application', id, ...(mode ? {mode} : {})}),
    minimizeApplication: () => {set('applicationMinimized')(true);sync()},
    restoreApplication: () => {set('applicationMinimized')(false);sync()},
    closeApplication: () => {set('applicationMinimized')(false);set('applicationView')(null);if (state.view === 'application') set('view')(state.applicationReturnView);sync()},
  }
  const dependencies = {normalizeAssistantMode, splitActiveRef, setAssistantMode: set('assistantMode'), setPanelMode: set('panelMode'), setAssistantOpen: set('assistantOpen'), setPendingPage: set('pendingPage'), navigate}
  const render = () => {
    sync()
    const scope = {...dependencies, sidebarAi: state.sidebarAi, panelMode: state.panelMode}
    return {...base, ...new Function(...Object.keys(scope), `${assistantJs}; return {${assistantNames.join(',')}}`)(...Object.values(scope))}
  }
  return {state, writes, errors, splitActiveRef, viewRef, applicationReturnView, applicationViewRef, applicationMinimizedRef, dependencies, render}
}

let passed = 0
async function test(name, run) {
  await run()
  passed += 1
  console.log(`通过：${name}`)
}

await test('分栏中打开应用的三种形态保留助手，其他布局沿用关闭行为', () => {
  for (const split of [true, false]) for (const mode of ['modal', 'drawer', 'page']) {
    const h = makeNavigation({split})
    h.state.view = 'settings'
    h.render().openApplication('notes', mode)
    assert.deepEqual(JSON.parse(JSON.stringify(h.state.applicationView)), {id: 'notes', mode})
    assert.equal(h.state.view, mode === 'page' ? 'application' : 'settings')
    assert.equal(h.state.activation.revision, 1)
    assert.equal(h.state.reader, null)
    assert.equal(h.state.assistantOpen, split)
    assert.equal(h.writes.filter((item) => item.key === 'assistantOpen').length, split ? 0 : 1)
  }
  const h = makeNavigation({split: true})
  h.render().openApplication('notes')
  assert.equal(h.state.applicationView.mode, 'drawer', '未指定模式应使用应用默认方式')
  const before = h.writes.length
  h.render().openApplication('missing')
  assert.equal(h.writes.length, before, '打开失败不能干扰当前导航或助手')
  assert.equal(h.errors.length, 1)
})

await test('设置、监控和市场在分栏中保留助手，非分栏仍关闭', () => {
  for (const split of [true, false]) for (const [callback, target] of [['openSettings', 'settings'], ['openMonitor', 'monitor'], ['openMarket', 'market']]) {
    const h = makeNavigation({split})
    h.render()[callback]('application:notes')
    assert.equal(h.state.view, target)
    assert.equal(h.state.activation.revision, 1)
    assert.equal(h.state.applicationView, null)
    assert.equal(h.state.assistantOpen, split)
    assert.equal(h.writes.filter((item) => item.key === 'assistantOpen').length, split ? 0 : 1)
    if (target === 'settings') {
      assert.equal(h.state.section, 'application:notes')
      assert.equal(h.state.reader, null)
    }
  }
})

await test('页面导航只更换左侧内容，不开关助手或改动布局偏好', () => {
  for (const split of [true, false]) for (const open of [true, false]) {
    const h = makeNavigation({split, panelMode: 'split'})
    h.state.assistantOpen = open
    h.render().goPage('reading')
    assert.equal(h.state.pageId, 'reading')
    assert.equal(h.state.view, 'page')
    assert.equal(h.state.activation.revision, 1)
    assert.equal(h.state.applicationView, null)
    assert.equal(h.state.assistantOpen, open)
    assert.equal(h.state.panelMode, 'split')
    assert.ok(h.writes.every((item) => !['assistantOpen', 'assistantMode', 'panelMode'].includes(item.key)))
  }
})

await test('最小化应用后各导航保留同一窗口身份，非最小化仍清理窗口', () => {
  for (const split of [true, false]) for (const minimized of [true, false]) for (const callback of ['goPage', 'openSettings', 'openMonitor', 'openMarket']) {
    const h = makeNavigation({split})
    const callbacks = h.render()
    callbacks.openApplication('notes', 'modal')
    h.render() // 模拟打开窗口后的一次 React 提交。
    if (minimized) callbacks.minimizeApplication()
    const instance = h.state.applicationView
    callbacks[callback](callback === 'goPage' ? 'reading' : 'ai')
    assert.equal(h.state.applicationView, minimized ? instance : null)
    if (minimized) {
      assert.equal(h.state.applicationMinimized, true)
      assert.equal(h.applicationMinimizedRef.current, true, '最小化需同步写 ref，避免同一帧导航销毁实例')
    }
  }
})

await test('AI open_page 的真实待处理 effect 同样保留最小化应用，并处理无效目标', () => {
  const effect = findNode((node) => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1]) && node.arguments[1].elements.some((item) => item.getText(ast) === 'pendingPage'))
  assert.ok(effect, '应有处理 open_page 的待处理 effect')
  for (const minimized of [true, false]) for (const pendingPage of ['reading', 'missing', null]) {
    const h = makeNavigation()
    h.state.applicationMinimized = minimized
    h.state.pendingPage = pendingPage
    h.render()
    const before = h.state.applicationView
    const runEffect = evaluate(effect.arguments[0], {...h.dependencies, pendingPage})
    runEffect()
    assert.equal(h.state.applicationView, !minimized && pendingPage === 'reading' ? null : before)
    assert.equal(h.state.pageId, pendingPage === 'reading' ? 'reading' : 'home')
    assert.equal(h.state.pendingPage, null)
    assert.equal(h.state.activation.revision, pendingPage === 'reading' ? 1 : 0)
  }
})

await test('最小化仍占用运行身份并暂停页面小组件，防止状态栏或widget启动第二份逻辑', () => {
  const activeExpression = declarations.get('activeApplicationIds')?.initializer
  const suspendedProp = findNode((node) => ts.isJsxAttribute(node) && node.name.getText(ast) === 'suspendedApplicationId')
  const resumeProp = findNode((node) => ts.isJsxAttribute(node) && node.name.getText(ast) === 'onResumeApplication')
  const minimizedHost = findNode((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ApplicationHost' && node.attributes.properties.some((item) => ts.isJsxAttribute(item) && item.name.getText(ast) === 'minimized'))
  assert.ok(minimizedHost && ts.isBinaryExpression(minimizedHost.parent), '最小化窗口应保留在全局宿主位置')
  assert.ok(suspendedProp?.initializer && ts.isJsxExpression(suspendedProp.initializer))
  assert.ok(resumeProp?.initializer && ts.isJsxExpression(resumeProp.initializer))
  for (const view of ['page', 'market', 'settings']) {
    const scope = {
      applicationView: {id: 'notes', mode: 'modal'}, applicationMinimized: true,
      applications: [{id: 'notes'}, {id: 'counter'}], view,
      currentPage: {components: [{id: 'notes'}, {id: 'counter'}, {id: 'clock'}]},
    }
    const active = evaluate(activeExpression, scope)
    assert.ok(active.includes('notes'), '隐藏窗口必须继续阻止同应用的紧凑视图运行')
    assert.equal(active.filter((id) => id === 'notes').length, 1)
    assert.equal(active.includes('counter'), view === 'page')
    assert.equal(evaluate(suspendedProp.initializer.expression, scope), 'notes', '隐藏窗口仍暂停同id页面小组件')
    assert.equal(evaluate(minimizedHost.parent.left, {...scope, openedApplication: {id: 'notes'}}), true, '最小化不能卸载全局窗口宿主')
    const h = makeNavigation()
    const callbacks = h.render()
    callbacks.minimizeApplication()
    const resume = evaluate(resumeProp.initializer.expression, {applicationMinimized: true, restoreApplication: callbacks.restoreApplication, closeApplication: callbacks.closeApplication})
    resume()
    assert.equal(h.state.applicationMinimized, false)
    assert.ok(h.state.applicationView, '小组件入口应恢复窗口，不能关闭仍持有内存状态的实例')
  }
})

await test('恢复最小化应用保留原形态，显式新形态优先，关闭清理最小化状态', () => {
  const h = makeNavigation({split: true})
  h.render().openApplication('notes', 'modal') // 目录默认 drawer，本次明确 modal。
  const callbacks = h.render()
  callbacks.minimizeApplication()
  assert.equal(h.applicationMinimizedRef.current, true)
  const sameWindow = h.state.applicationView
  callbacks.restoreApplication()
  assert.equal(h.state.applicationView, sameWindow, '恢复不应重建身份或改动mode')
  assert.equal(h.state.applicationMinimized, false)
  assert.equal(h.applicationMinimizedRef.current, false)
  callbacks.minimizeApplication()
  callbacks.openApplication('notes')
  assert.equal(h.state.applicationView.mode, 'modal', '从目录恢复时不能套用默认drawer而重挂运行时')
  assert.equal(h.state.applicationMinimized, false)
  assert.equal(h.applicationMinimizedRef.current, false)
  h.render().minimizeApplication()
  h.render().openApplication('notes', 'drawer')
  assert.equal(h.state.applicationView.mode, 'drawer', '显式请求仍可选择其他形态')
  h.render().minimizeApplication()
  h.render().openApplication('counter')
  assert.deepEqual(JSON.parse(JSON.stringify(h.state.applicationView)), {id: 'counter', mode: 'modal'})
  const closing = h.render()
  closing.minimizeApplication()
  closing.closeApplication()
  assert.equal(h.state.applicationView, null)
  assert.equal(h.state.applicationMinimized, false)
  assert.equal(h.applicationMinimizedRef.current, false)
})

await test('统一导航同目标每次发布revision，非法页面/应用/模式失败无修改', () => {
  const h = makeNavigation({split: true})
  h.render().goPage('reading')
  const first = h.state.activation.revision
  h.render().goPage('reading')
  assert.equal(h.state.activation.revision, first + 1)
  for (const target of [{kind: 'page', id: 'missing'}, {kind: 'application', id: 'missing'}, {kind: 'application', id: 'notes', mode: 'invalid'}]) {
    const before = JSON.stringify(h.state)
    const count = h.writes.length
    assert.equal(h.render().navigate(target).ok, false)
    assert.equal(JSON.stringify(h.state), before)
    assert.equal(h.writes.length, count)
  }
})
await test('真实导航hook同帧执行与应用最小化恢复沿用最新身份', () => {
  const cells = []
  let cursor = 0
  let writes = 0
  const react = {
    useCallback: fn => fn,
    useRef: value => {const at = cursor++; return cells[at] ??= {current: value}},
    useState: value => {const at = cursor++; if (!(at in cells)) cells[at] = typeof value === 'function' ? value() : value; return [cells[at], value => {writes++;cells[at] = typeof value === 'function' ? value(cells[at]) : value}]},
  }
  const workspace = {pages: [{id: 'home', name: '首页'}], applications: [{id: 'notes', openMode: 'drawer', instance: {title: '笔记'}}]}
  const api = compile('src/lib/useNavigation.ts', {react, './shell/navigation': navigation, './market': {isInstalled: () => false}, './workspaceStore': {getWorkspace: () => workspace}})
  const options = {pageId: 'home', setPageId: () => {}, clearReader: () => {}, closeAssistant: () => {}, splitActive: true}
  const render = () => {cursor = 0; return api.useNavigation(options)}
  const host = render()
  host.navigate({kind: 'application', id: 'notes', mode: 'modal'})
  host.minimizeApplication()
  host.navigate({kind: 'page', id: 'home'})
  let result = render()
  assert.equal(result.applicationView.id, 'notes')
  assert.equal(result.applicationMinimized, true)
  const instance = result.applicationView
  result.restoreApplication()
  result = render()
  assert.equal(result.applicationView, instance)
  assert.equal(result.applicationMinimized, false)
  result.closeApplication()
  assert.equal(render().applicationView, null)
  const before = writes
  assert.equal(host.navigate({kind: 'page', id: 'missing'}).ok, false)
  assert.equal(writes, before)
})
await test('指定设置入口连续打开相同目标也产生新导航请求，普通进入不强制切详情', () => {
  const h = makeNavigation({split: true})
  h.render().openSettings()
  assert.equal(h.state.settingsRequest, 0)
  for (const request of [1, 2]) {
    h.render().openSettings('ai')
    assert.equal(h.state.section, 'ai')
    assert.equal(h.state.settingsRequest, request)
    assert.equal(h.state.assistantOpen, true)
  }
  h.render().openSettings('')
  assert.equal(h.state.settingsRequest, 2)
})

await test('真实设置页 effect 按每次外部请求恢复详情，同目标重复打开也有效', () => {
  const settingsSource = readFileSync(new URL('../src/components/SettingsPage.tsx', import.meta.url), 'utf8')
  const settingsAst = ts.createSourceFile('SettingsPage.tsx', settingsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const effects = []
  const collect = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(settingsAst) === 'useEffect') effects.push(node)
    ts.forEachChild(node, collect)
  }
  collect(settingsAst)
  const effect = effects.find((call) => call.arguments[1] && ts.isArrayLiteralExpression(call.arguments[1]) && call.arguments[1].elements.some((item) => item.getText(settingsAst) === 'openRequest'))
  assert.ok(effect, '设置页应订阅外部导航请求，不能仅监听 section')
  const effectJs = ts.transpileModule(`const effect = ${effect.arguments[0].getText(settingsAst)}`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText
  let pane = 'list'
  const applyRequest = (openRequest) => new Function('openRequest', 'setPane', `${effectJs}; effect()`)(openRequest, (next) => {pane = next})
  applyRequest(0)
  assert.equal(pane, 'list', '未指定目标时保留设置列表')
  const h = makeNavigation({split: true})
  for (const request of [1, 2]) {
    pane = 'list' // 用户在窄画布中点击返回，随后从助手再次打开同一个设置项。
    h.render().openSettings('ai')
    assert.equal(h.state.settingsRequest, request)
    applyRequest(h.state.settingsRequest)
    assert.equal(pane, 'detail')
  }
})

await test('抽屉和分栏更新面板偏好，全屏切换不覆盖原面板模式', () => {
  const h = makeNavigation()
  for (const panel of ['split', 'drawer']) {
    h.render().changeAssistantMode(panel)
    assert.equal(h.state.assistantMode, panel)
    assert.equal(h.state.panelMode, panel)
    const previousWrites = h.writes.filter((item) => item.key === 'panelMode').length
    h.render().changeAssistantMode('full')
    assert.equal(h.state.assistantMode, 'full')
    assert.equal(h.state.panelMode, panel)
    assert.equal(h.writes.filter((item) => item.key === 'panelMode').length, previousWrites)
  }
})

await test('Logo 面板默认打开抽屉，恢复上次分栏且不使用 Dock 的全屏偏好', () => {
  assert.equal(storedDefault('panelMode'), 'drawer')
  const initial = makeNavigation({sidebarAi: 'full'})
  initial.state.assistantOpen = false
  initial.render().openAssistantPanel()
  assert.equal(initial.state.assistantMode, 'drawer')
  assert.equal(initial.state.assistantOpen, true)
  const remembered = makeNavigation({panelMode: 'split', sidebarAi: 'full'})
  remembered.render().changeAssistantMode('full')
  remembered.state.assistantOpen = false
  remembered.render().openAssistantPanel()
  assert.equal(remembered.state.assistantMode, 'split')
  assert.equal(remembered.state.panelMode, 'split')
  assert.equal(remembered.state.assistantOpen, true)
})

await test('Dock 默认全屏并支持三态偏好，显式打开方式覆盖本次偏好', () => {
  assert.equal(storedDefault('sidebarAi'), 'full')
  for (const sidebarAi of ['drawer', 'split', 'full']) {
    const h = makeNavigation({sidebarAi, panelMode: 'split'})
    h.state.assistantOpen = false
    h.render().openAssistant()
    assert.equal(h.state.assistantMode, sidebarAi)
    assert.equal(h.state.assistantOpen, true)
    assert.equal(h.state.panelMode, sidebarAi === 'full' ? 'split' : sidebarAi)
    h.render().openAssistant('drawer')
    assert.equal(h.state.assistantMode, 'drawer')
  }
})

await test('AI 设置工具支持 split 的 schema、保存和读取，非法偏好不覆盖', async () => {
  const storage = new Map()
  class WorkspaceError extends Error {}
  const tools = compile('src/lib/siteTools.ts', {
    '@tulai-design/agent-core': {createToolFactory: () => (schema, definition) => ({...definition, parameters: schema.json, parseArguments: schema.schema.parse})},
    './store': {readStored: (key, fallback) => storage.has(key) ? storage.get(key) : fallback, writeStored: (key, value) => storage.set(key, value)},
    './errors': {WorkspaceError}, './skills': {SKILLS: []},
    './defaults': {SEARCH_ENGINES: [], defaultSettings: () => ({name: '朋友', city: '上海', lat: 31, lon: 121, ai: {model: 'test', apiKey: ''}})},
    './webSearch': {readSearchConfig: () => ({}), providerInfo: () => null},
    './permissions': {isAlwaysAllowed: () => false}, './workspaceStore': {getWorkspace: () => ({addons: []})},
  }).SITE_TOOLS
  const update = tools.find((tool) => tool.name === 'update_settings')
  const read = tools.find((tool) => tool.name === 'get_settings')
  assert.deepEqual(Array.from(update.parameters.properties.sidebarAi.enum).sort(), ['drawer', 'full', 'split'])
  assert.match(await update.execute(update.parseArguments({sidebarAi: 'split'}), {}), /已更新/)
  assert.equal(storage.get('sidebarAi'), 'split')
  assert.match(await read.execute({}, {}), /Dock AI 入口：分栏/)
  await assert.rejects(() => update.execute(update.parseArguments({sidebarAi: 'invalid'}), {}), /sidebarAi/)
  assert.equal(storage.get('sidebarAi'), 'split')
})

await test('删除后台页面只修引用，保留系统页和打开应用；当前页面删除才成功激活回退', () => {
  const workspace = {pages: [{id: 'home', name: '首页'}], applications: []}
  const base = {...navigationApi.initialNavigation('removed'), section: 'ai', settingsRequest: 3}
  for (const view of ['settings', 'market', 'monitor', 'application', 'page']) {
    for (const mode of ['modal', 'drawer', 'page']) {
      const state = {...base, view, applicationView: {id: 'running', mode}, applicationMinimized: false}
      const next = navigationApi.reconcileNavigationPage(state, workspace, {monitorInstalled: true, splitActive: true})
      assert.equal(next.pageId, 'home')
      assert.equal(next.view, view)
      assert.deepEqual(next.applicationView, state.applicationView)
      assert.equal(next.activation.revision, state.activation.revision)
      assert.equal(next.section, 'ai')
      assert.equal(next.settingsRequest, 3)
    }
  }
  const fallback = navigationApi.reconcileNavigationPage(base, workspace, {monitorInstalled: true, splitActive: true})
  assert.equal(fallback.pageId, 'home')
  assert.equal(fallback.view, 'page')
  assert.equal(fallback.activation.revision, base.activation.revision + 1)
  assert.equal(fallback.activation.target.id, 'home')
  assert.equal(navigationApi.reconcileNavigationPage(fallback, workspace, {monitorInstalled: true, splitActive: true}), fallback)
})

console.log(`AI 导航与布局偏好回归全部通过：${passed}/${passed}`)
