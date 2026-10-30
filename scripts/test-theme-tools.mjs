import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// 运行真实工具解析、主题/外观纯函数及列表输出；仅替换浏览器存储和无关工具依赖。
const modules = new Map()
const coreFiles = new Set(['errors', 'fonts', 'workspace', 'themes', 'themeCatalog', 'dock', 'appearance'])
function loadCore(name) {
  if (modules.has(name)) return modules.get(name).exports
  const module = {exports: {}}
  modules.set(name, module)
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(js, {module, exports: module.exports, require: (id) => {
    if (id === '../fx/policy') return loadFx('policy')
    const dependency = id.replace(/^\.\//, '')
    assert(coreFiles.has(dependency), `未声明的核心依赖：${id}`)
    return loadCore(dependency)
  }})
  return module.exports
}
function loadFx(name) {
  const module = {exports: {}}
  const source = readFileSync(new URL(`../src/fx/${name}.ts`, import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(js, {module, exports: module.exports, require: (id) => id === '../lib/errors' ? loadCore('errors') : loadFx(id.replace(/^\.\//, ''))})
  return module.exports
}
const themes = loadCore('themes')
const model = loadCore('workspace')
const {WorkspaceError} = loadCore('errors')
let workspace
let commits
const dependencies = {
  '@tulai-design/agent-core': {createToolFactory: () => (schema, definition) => ({...definition, parameters: schema.json, parse: schema.schema.parse})},
  './errors': {WorkspaceError},
  './workspace': model,
  './themes': themes,
  './appearance': loadCore('appearance'),
  './workspaceStore': {getWorkspace: () => workspace, commit: (next) => {workspace = next; commits += 1}},
  './ops': {setTheme: themes.tweakTheme, saveTheme: themes.saveTheme, applyTheme: themes.applyTheme},
  './dock': loadCore('dock'),
  './market': {ADDONS: []},
  '../fx/policy': loadFx('policy'),
  './siteTools': {SITE_TOOLS: []},
  './lifeTools': {LIFE_TOOLS: []}, './homepageDraftTools': {HOMEPAGE_DRAFT_TOOLS: []},
  './searchTools': {SEARCH_TOOLS: []},
}
const module = {exports: {}}
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/tools.ts', import.meta.url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
vm.runInNewContext(compiled, {module, exports: module.exports, require: (id) => dependencies[id] ?? {}})
const tools = module.exports.HOME_TOOLS
const tool = (name) => tools.find((item) => item.name === name)
const run = (name, args = {}) => {const item = tool(name); return item.execute(item.parse(args))}
const active = () => model.activeTheme(workspace)
const plain = (value) => JSON.parse(JSON.stringify(value))
const reset = () => {
  workspace = {pages: [], templates: [], theme: {active: 'default', mode: 'light', base: 'light'}, themes: [model.DEFAULT_THEME, model.IOS_THEME, model.PIXEL_THEME, model.SWITCH_THEME, model.WIN98_THEME]}
  commits = 0
}
const palettes = {light: {bg: '#f4fafb', text: '#172f38', border: '#ccddee'}, dark: {bg: '#10232b', text: '#e5f3f7', border: '#334455'}}
let passed = 0
async function test(name, runTest) {reset(); await runTest(); passed += 1; console.log(`通过：${name}`)}

await test('主题工具 schema 接受模式对象和显式 null，拒绝无效参数', async () => {
  for (const name of ['save_theme', 'set_theme']) {
    for (const field of ['overrides', 'light', 'dark']) {
      assert.deepEqual(plain(tool(name).parameters.properties[field].type), ['object', 'null'])
      assert.equal(tool(name).parse({[field]: null})[field], null)
      for (const value of [[], 'invalid', 17]) assert.throws(() => tool(name).parse({[field]: value}), /CSS 变量对象/)
    }
  }
  for (const from of ['', 17, null, {}]) assert.throws(() => tool('save_theme').parse({name: '新主题', from}), /from/)
  assert.equal(commits, 0)
})
await test('工具修改五种内置主题保留完整造型与外壳，并回读有效主色和来源', async () => {
  for (const preset of [model.DEFAULT_THEME, model.IOS_THEME, model.PIXEL_THEME, model.SWITCH_THEME, model.WIN98_THEME]) {
    reset()
    workspace = themes.applyTheme(workspace, preset.id).workspace
    await run('set_theme', {overrides: {main: '#663399'}})
    assert.notEqual(active().id, preset.id)
    assert.equal(active().skin, {default: 'paper', ios: 'ios', pixel: 'pixel', switch: 'switch', win98: 'win98'}[preset.id])
    assert.equal(active().shell, preset.shell)
    assert.deepEqual(active().fonts && plain(active().fonts), preset.fonts && plain(preset.fonts))
    const listed = await run('list_themes')
    assert.match(listed, new RegExp(`skin ${preset.skin}.*shell ${preset.shell}`))
    const appearance = JSON.parse(await run('get_appearance'))
    assert.equal(appearance.current.theme.resolved.main, '#663399')
    assert.match(listed, /有效值.*#663399/)
    assert.match(listed, /来源.*shared/)
  }
})
await test('save_theme 显式选择来源保留完整设计，更新不能改来源且失败不提交', async () => {
  await run('save_theme', {name: '紫色主机', from: 'switch'})
  assert.equal(active().skin, 'switch')
  assert.equal(active().shell, 'switch')
  assert.deepEqual(plain(active().light), plain(model.SWITCH_THEME.light))
  const count = commits
  const before = JSON.stringify(workspace)
  await assert.rejects(() => run('save_theme', {id: active().id, from: 'ios'}), /./)
  assert.equal(commits, count)
  assert.equal(JSON.stringify(workspace), before)
})
await test('AI 保存双模式主题后真实列表包含共享与两套配色', async () => {
  const result = await run('save_theme', {name: '海湾', mode: 'dark', overrides: {main: '#397c95', radius: '8px'}, ...palettes})
  assert.match(result, /已新建/)
  assert.equal(workspace.theme.mode, 'dark')
  assert.deepEqual(plain(active().light), palettes.light)
  assert.deepEqual(plain(active().dark), palettes.dark)
  const listed = await run('list_themes')
  assert.match(listed, /当前 dark/)
  assert.match(listed, /初始偏好 dark（仍可切换）/)
  assert.match(listed, /共享 overrides.*radius/)
  assert.match(listed, /浅色 light.*#f4fafb/)
  assert.match(listed, /深色 dark.*#10232b/)
})
await test('set_theme 旧 overrides 核心颜色只修改当前模式，共享尺寸仍共用', async () => {
  await run('save_theme', {name: '海湾', ...palettes})
  await run('set_theme', {mode: 'dark', overrides: {bg: '#20313a', text: '#f0f7fa', radius: '12px'}})
  assert.deepEqual(plain(active().light), palettes.light)
  assert.equal(active().dark.bg, '#20313a')
  assert.equal(active().dark.text, '#f0f7fa')
  assert.equal(active().dark.border, palettes.dark.border)
  assert.equal(active().overrides.radius, '12px')
  assert.equal(active().overrides.bg, undefined)
  assert.equal(themes.resolveThemeOverrides(active(), 'light').bg, palettes.light.bg)
  assert.equal(themes.resolveThemeOverrides(active(), 'dark').bg, '#20313a')
})
await test('save_theme 替换单分支，set_theme 合并单分支，未传另一分支保留', async () => {
  await run('save_theme', {name: '海湾', ...palettes})
  await run('save_theme', {id: active().id, light: {bg: '#ffffff'}, activate: false})
  assert.deepEqual(plain(active().light), {bg: '#ffffff'})
  assert.deepEqual(plain(active().dark), palettes.dark)
  await run('set_theme', {light: {text: '#112233'}})
  assert.deepEqual(plain(active().light), {bg: '#ffffff', text: '#112233'})
  assert.deepEqual(plain(active().dark), palettes.dark)
})
await test('两种写工具可显式清空单分支，列表如实说明回落', async () => {
  await run('save_theme', {name: '海湾', ...palettes})
  await run('save_theme', {id: active().id, dark: null, activate: false})
  assert.equal(active().dark, undefined)
  assert.deepEqual(plain(active().light), palettes.light)
  assert.match(await run('list_themes'), /深色 dark 未单独覆盖，继承共享变量与系统深色基础配色/)
  await run('set_theme', {light: null})
  assert.equal(active().light, undefined)
  assert.match(await run('list_themes'), /浅色 light 未单独覆盖，继承共享变量与系统浅色基础配色/)
})
await test('set_theme 清空所有定制时包含两模式和字体', async () => {
  await run('save_theme', {name: '海湾', overrides: {radius: '8px'}, fonts: [{family: 'Noto Sans SC', role: 'sans'}], ...palettes})
  await run('set_theme', {overrides: null})
  assert.deepEqual(plain(active().overrides), {})
  assert.equal(active().light, undefined)
  assert.equal(active().dark, undefined)
  assert.equal(active().fonts, undefined)
})
await test('只修改字体或外框仍可创建主题，默认主题保持不变', async () => {
  await run('set_theme', {overrides: {frame: '0px'}})
  assert.notEqual(active().id, 'default')
  assert.equal(active().overrides.frame, '0px')
  assert.equal(active().light, undefined)
  assert.equal(active().dark, undefined)
  assert.deepEqual(plain(workspace.themes.find((item) => item.id === 'default').overrides), {})
  await run('save_theme', {name: '阅读字体', fonts: [{family: 'Noto Serif SC', role: 'serif'}]})
  assert.equal(active().fonts[0].family, 'Noto Serif SC')
  assert.equal(active().light, undefined)
  assert.equal(active().dark, undefined)
})
await test('模式分支无效 CSS 不提交，保留先前有效主题', async () => {
  await run('save_theme', {name: '海湾', ...palettes})
  const before = JSON.stringify(workspace)
  const count = commits
  await assert.rejects(() => run('set_theme', {dark: {bg: '#123; color:red'}}), /./)
  assert.equal(JSON.stringify(workspace), before)
  assert.equal(commits, count)
})

const decoratedWorkspace = async () => {
  await run('save_theme', {name: '海湾', overrides: {frame: '0px'}, fonts: [{family: 'Noto Serif SC', role: 'serif'}], ...palettes})
  workspace.theme.mode = 'dark'
  workspace.pages = [
    {id: 'home', name: '首页', align: 'end', wallpaper: {mode: 'custom', url: 'https://example.com/home.jpg'}, layers: [{id: 'home-glow', type: 'glow', opacity: 0.5}], css: '.page {color:red}', components: [
      {id: 'clock', type: 'clock', span: 'half', config: {timezone: 'Asia/Shanghai'}, look: {variant: 'plain', css: '.card {color:blue}'}},
      {id: 'custom-app', type: 'app', span: 'full', config: {source: '<main>我的应用</main>'}, look: {tone: 'accent'}},
    ]},
    {id: 'work', name: '工作', align: 'center', wallpaper: {mode: 'unsplash', index: 2}, layers: [{id: 'rain', type: 'rain'}], css: '.page {opacity:0.9}', components: [
      {id: 'notes', type: 'notes', span: 'third', config: {text: '保留这条笔记'}, look: {animation: 'float'}},
      {id: 'fx', type: 'fx', span: 'half', config: {effect: 'particles', count: 20}},
    ]},
  ]
  workspace.dock = {preset: 'solid', css: '.dock {border-radius:0}'}
  workspace.templates = [{id: 'saved-layout', name: '我的模板', pages: []}]
  workspace.layout = {columns: 6}
  workspace.statusbar = {visible: false}
  workspace.businessData = {notes: '此数据不属于外观'}
}

await test('get_appearance 读取真实默认、当前和差异且不提交', async () => {
  await decoratedWorkspace()
  const count = commits
  const appearance = JSON.parse(await run('get_appearance'))
  assert.equal(appearance.defaults.theme.shared.frame, '0px')
  assert.equal(appearance.defaults.dock.preset, 'glass')
  assert.deepEqual(appearance.defaults.home.layers, plain(model.DEFAULT_HOME_LAYERS))
  assert.equal(appearance.current.mode, 'dark')
  assert.equal(appearance.current.theme.resolved.bg, palettes.dark.bg)
  assert.equal(appearance.differences.theme, true)
  assert.equal(appearance.differences.dock, true)
  assert.deepEqual(appearance.differences.pages[0].componentLooks, ['clock', 'custom-app'])
  assert.deepEqual(appearance.current.pages[0].embeddedVisuals.map((item) => item.id), ['custom-app'])
  assert.equal(commits, count)
})
await test('reset_appearance 全局一次提交恢复默认并保留内容、布局、库和当前明暗', async () => {
  await decoratedWorkspace()
  const before = plain(workspace)
  const count = commits
  assert.match(await run('reset_appearance'), /已恢复默认外观/)
  assert.equal(commits, count + 1)
  assert.equal(workspace.theme.active, 'ios')
  assert.equal(workspace.theme.mode, 'dark')
  assert.equal(workspace.dock, undefined)
  assert.deepEqual(plain(workspace.pages[0].layers), plain(model.DEFAULT_HOME_LAYERS))
  assert.equal(workspace.pages[1].layers, undefined)
  for (const [index, page] of workspace.pages.entries()) {
    assert.equal(page.wallpaper, undefined)
    assert.equal(page.css, undefined)
    assert.equal(page.align, before.pages[index].align)
    assert.equal(page.name, before.pages[index].name)
    assert.deepEqual(plain(page.components), before.pages[index].components.map(({look, ...content}) => content))
  }
  for (const key of ['templates', 'layout', 'statusbar', 'businessData']) assert.deepEqual(plain(workspace[key]), before[key])
  assert.deepEqual(plain(workspace.themes.filter((item) => item.id !== 'default')), before.themes.filter((item) => item.id !== 'default'))
  const appearance = JSON.parse(await run('get_appearance'))
  assert.equal(appearance.differences.theme, false)
  assert.equal(appearance.differences.dock, false)
  for (const page of appearance.differences.pages) {
    assert.equal(page.wallpaper, false)
    assert.equal(page.layers, false)
    assert.equal(page.css, false)
    assert.deepEqual(page.componentLooks, [])
  }
  assert.deepEqual(appearance.differences.pages.map((page) => page.embeddedVisuals), [['custom-app'], ['fx']])
})
await test('reset_appearance 首页范围不改变全局主题、Dock 和其他页面', async () => {
  await decoratedWorkspace()
  const before = plain(workspace)
  const count = commits
  assert.match(await run('reset_appearance', {scope: 'home'}), /已恢复首页默认外观/)
  assert.equal(commits, count + 1)
  for (const key of ['theme', 'themes', 'dock', 'templates', 'layout']) assert.deepEqual(plain(workspace[key]), before[key])
  assert.deepEqual(plain(workspace.pages[1]), before.pages[1])
  assert.equal(workspace.pages[0].align, before.pages[0].align)
  assert.equal(workspace.pages[0].wallpaper, undefined)
  assert.equal(workspace.pages[0].css, undefined)
  assert.deepEqual(plain(workspace.pages[0].layers), plain(model.DEFAULT_HOME_LAYERS))
  assert.deepEqual(plain(workspace.pages[0].components), before.pages[0].components.map(({look, ...content}) => content))
})
await test('reset_appearance 默认背景与保留效果块超限时给出原因，主题和页面均不提交', async () => {
  await decoratedWorkspace()
  workspace.pages[0].layers = []
  workspace.pages[0].components.push({id: 'silk-banner', type: 'fx', config: {effect: 'silk', text: '保留横幅'}})
  const before = JSON.stringify(workspace)
  const count = commits
  for (const input of [{scope: 'home'}, {scope: 'all', mode: 'light'}]) {
    await assert.rejects(() => run('reset_appearance', input), /特效超出预算/)
    assert.equal(JSON.stringify(workspace), before)
    assert.equal(commits, count)
  }
})
await test('reset_appearance 严格拒绝非法范围和模式，全局支持显式明暗', async () => {
  await decoratedWorkspace()
  const before = JSON.stringify(workspace)
  const count = commits
  for (const scope of ['page', '', null, 1]) assert.throws(() => tool('reset_appearance').parse({scope}), /scope/)
  for (const mode of ['auto', '', null, 1]) assert.throws(() => tool('reset_appearance').parse({mode}), /mode/)
  await assert.rejects(() => run('reset_appearance', {scope: 'home', mode: 'light'}), /./)
  assert.equal(JSON.stringify(workspace), before)
  assert.equal(commits, count)
  await run('reset_appearance', {scope: 'all', mode: 'light'})
  assert.equal(workspace.theme.mode, 'light')
  assert.equal(workspace.theme.active, 'ios')
})
await test('apply_theme default 仅切配色，仍保留背景、组件外观和 Dock', async () => {
  await decoratedWorkspace()
  const before = plain(workspace)
  await run('apply_theme', {ref: 'default'})
  assert.equal(workspace.theme.active, 'default')
  assert.deepEqual(plain(workspace.pages), before.pages)
  assert.deepEqual(plain(workspace.dock), before.dock)
})
await test('默认玻璃Dock可直接渲染，iOS和掌机的既有显示规则及通栏仍保留', async () => {
  const dock = loadCore('dock')
  const plainDock = (value) => JSON.parse(JSON.stringify(value ?? null))
  assert.equal(dock.visibleDock(undefined, false), undefined)
  assert.equal(dock.visibleDock(undefined, true), undefined)
  assert.equal(dock.DEFAULT_DOCK_PRESET, 'glass')
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'solid'}, true)), {preset: 'glass'})
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'bar'}, true)), {preset: 'bar'})
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'glass', css: '.dock{color:red}'}, true)), {preset: 'glass', css: '.dock{color:red}'})
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'solid', css: '.dock{color:red}'}, true)), {preset: 'glass', css: '.dock{color:red}'})
  assert.deepEqual(plainDock(dock.visibleDock(undefined, false, true)), {preset: 'solid'})
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'glass'}, false, true)), {preset: 'solid'})
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'glass', css: '.dock{color:red}'}, false, true)), {preset: 'solid', css: '.dock{color:red}'})
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'bar'}, false, true)), {preset: 'bar'})
  assert.deepEqual(plainDock(dock.visibleDock({preset: 'solid'}, false, true)), {preset: 'solid'})
})
console.log(`主题工具回归全部通过：${passed}/${passed}`)
