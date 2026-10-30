import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

// 执行真实主题领域与读取模块；不触碰用户数据、网络或浏览器。
const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map(), mocks = new Map()
function load(relative) {
  const file = path.resolve(root, relative)
  if (mocks.has(file)) return mocks.get(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = {exports: {}}; cache.set(file, module)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = id => {
    if (id === 'react') return {useCallback: fn => fn, useSyncExternalStore() {}}
    assert.ok(id.startsWith('.'), `未隔离的外部依赖：${id}`)
    return load(path.resolve(path.dirname(file), `${id}.ts`))
  }
  new Function('module', 'exports', 'require', 'localStorage', compiled)(module, module.exports, require, {getItem: () => null, setItem() {}})
  return module.exports
}
const model = load('src/lib/workspace.ts'), themes = load('src/lib/themes.ts')
const clone = value => JSON.parse(JSON.stringify(value))
const base = (active = 'ios') => ({
  version: model.WORKSPACE_VERSION, pages: [{id: 'home', name: '首页', label: '首页', components: []}],
  statusbar: [], addons: [], widgets: [], network: [], templates: [], applications: [],
  layout: {columns: 12, maxWidth: 1440}, theme: {active, mode: 'light', base: 'dark', frameOff: true}, themes: themes.readThemes([]),
})
let passed = 0
const failures = []
function test(name, fn) {try {fn(); passed++; console.log(`通过：${name}`)} catch (error) {failures.push(name); console.error(`失败：${name}\n${error.stack}`)}}
for (const id of ['default', 'ios', 'pixel', 'switch', 'win98']) test(`${id} 完整派生保留实现与字体，共享主色实际覆盖两种模式`, () => {
  const ws = base(id), original = clone(model.activeTheme(ws))
  const result = themes.tweakTheme(ws, {overrides: {main: '#663399'}})
  const theme = model.activeTheme(result.workspace)
  for (const mode of ['light', 'dark']) assert.equal(themes.resolveThemeOverrides(theme, mode).main, '#663399')
  assert.equal(theme.skin, id === 'default' ? 'paper' : id)
  assert.equal(theme.shell, ['switch', 'win98'].includes(id) ? id : 'standard')
  assert.deepEqual(theme.fonts, original.fonts)
  assert.deepEqual(theme.origin, {definitionId: id, version: 1})
  for (const [key, value] of Object.entries(original.overrides)) if (key !== 'main') assert.equal(theme.overrides[key], value)
  for (const mode of ['light', 'dark']) for (const [key, value] of Object.entries(original[mode] ?? {})) if (key !== 'main') assert.equal(theme[mode][key], value)
  assert.deepEqual(ws.themes.find(theme => theme.id === id), original)
  assert.deepEqual({...result.workspace.theme, active: id}, ws.theme)
})
test('另存默认当前完整快照，也可显式选择来源；改名保留身份且拒绝重选来源', () => {
  const ws = base('switch'), original = model.activeTheme(ws)
  const result = themes.saveTheme(ws, {name: '紫色主机', overrides: {main: '#663399'}})
  assert.equal(result.theme.skin, 'switch'); assert.equal(result.theme.shell, 'switch')
  assert.deepEqual(result.theme.dark.bg, original.dark.bg)
  const other = themes.saveTheme(ws, {name: '另一台桌面', from: 'win98', activate: false})
  assert.equal(other.theme.shell, 'win98'); assert.deepEqual(other.theme.light, model.WIN98_THEME.light)
  const renamed = themes.saveTheme(result.workspace, {id: result.theme.id, name: '新名称'})
  assert.deepEqual(renamed.theme.origin, result.theme.origin); assert.equal(renamed.theme.shell, 'switch')
  assert.throws(() => themes.saveTheme(result.workspace, {id: result.theme.id, from: 'ios'}))
})
test('共享输入清旧分支遮盖，显式模式值仍优先，局部模式不污染另一模式', () => {
  const first = themes.tweakTheme(base('ios'), {overrides: {main: '#663399'}, dark: {main: '#aa77cc'}}).workspace
  assert.equal(themes.resolveThemeOverrides(model.activeTheme(first), 'light').main, '#663399')
  assert.equal(themes.resolveThemeOverrides(model.activeTheme(first), 'dark').main, '#aa77cc')
  const second = themes.tweakTheme(first, {overrides: {bg: '#f5f0fa'}}).workspace
  assert.equal(themes.resolveThemeOverrides(model.activeTheme(second), 'light').bg, '#f5f0fa')
  assert.equal(themes.resolveThemeOverrides(model.activeTheme(second), 'dark').bg, model.IOS_THEME.dark.bg)
})
test('有效值与来源包含字体、模式及frame偏好，清空仍有宿主skin必需值', () => {
  const ws = themes.tweakTheme(base('ios'), {overrides: {main: '#663399'}}).workspace
  const entry = model.activeTheme(ws)
  const resolved = themes.resolveTheme(entry, 'light', {frameOff: true})
  assert.equal(resolved.values.main, '#663399'); assert.equal(resolved.sources.main, 'light')
  assert.equal(resolved.sources.bg, 'light'); assert.equal(resolved.sources['font-serif'], 'font')
  assert.equal(resolved.values.frame, '0px'); assert.equal(resolved.sources.frame, 'preference')
  for (const id of ['switch', 'win98']) {
    const changed = themes.tweakTheme(base(id), {overrides: {main: '#663399'}}).workspace
    const cleared = themes.tweakTheme(changed, {overrides: null}).workspace
    const custom = model.activeTheme(cleared), actual = themes.resolveTheme(custom, 'dark')
    assert.equal(custom.skin, id); assert.equal(custom.shell, id); assert.equal(custom.fonts, undefined)
    const token = id === 'switch' ? 'switch-focus' : 'win98-face'
    assert.equal(actual.values[token], model[id === 'switch' ? 'SWITCH_THEME' : 'WIN98_THEME'].dark[token])
    assert.equal(actual.sources[token], 'default'); assert.equal(actual.overrides[token], actual.values[token])
    assert.deepEqual(themes.swatch(custom, 'dark'), {bg: actual.values.bg, text: actual.values.text, main: actual.values.main})
  }
})
test('save中性颜色只写明确目标模式，不按颜色明度或来源初始模式猜测', () => {
  const ws = themes.setMode(base('ios'), 'dark')
  const first = themes.saveTheme(ws, {name: '深色中的白背景', overrides: {bg: '#ffffff'}})
  assert.equal(first.theme.dark.bg, '#ffffff'); assert.equal(first.theme.light.bg, model.IOS_THEME.light.bg)
  const second = themes.saveTheme(ws, {name: '明确浅色', mode: 'light', overrides: {bg: '#111111'}})
  assert.equal(second.theme.light.bg, '#111111'); assert.equal(second.theme.dark.bg, model.IOS_THEME.dark.bg)
})
// 模板和重读使用真实模块，外围页面注册仅为无副作用替身。
mocks.set(path.resolve(root, 'src/lib/ops.ts'), {defaultWorkspace: base})
mocks.set(path.resolve(root, 'src/lib/registry.ts'), {getDefinition: () => undefined, normalizeConfig: (_definition, config) => config})
mocks.set(path.resolve(root, 'src/fx/catalog.ts'), {normalizeLayer: () => {throw new Error('测试中没有特效')}})
mocks.set(path.resolve(root, 'src/lib/pageIcons.ts'), {isPageIcon: () => false})
mocks.set(path.resolve(root, 'src/lib/market.ts'), {ADDONS: []})
mocks.set(path.resolve(root, 'src/lib/presets.ts'), {PRESETS: [], findPreset: () => undefined})
const store = load('src/lib/workspaceStore.ts'), templates = load('src/lib/templates.ts')
test('同一本地字体承担多个角色时，主题与模板JSON往返保留完整角色设计', () => {
  const resource = {packageId: 'test.roles', version: '1.0.0', digest: 'a'.repeat(64), resourceId: 'main', sha256: 'b'.repeat(64)}
  const fonts = ['sans', 'serif'].map(role => ({family: 'Local Test', role, resource}))
  const created = themes.saveTheme(base('ios'), {name: '多角色字体', fonts})
  assert.deepEqual(created.theme.fonts, fonts)
  const reloaded = themes.readThemes(clone(created.workspace.themes)).find(theme => theme.id === created.theme.id)
  assert.deepEqual(reloaded.fonts, fonts)
  const saved = templates.saveTemplate(created.workspace, {name: '字体快照'}).workspace
  const restored = store.migrate(clone(saved))
  assert.deepEqual(restored.templates[0].snapshot.theme.fonts, fonts)
  const adopted = templates.applyTemplate(themes.applyTheme(restored, 'ios').workspace, restored.templates[0].id).workspace
  assert.deepEqual(model.activeTheme(adopted).fonts, fonts)
  const before = load('src/lib/fonts.ts').fontVars(fonts)
  const after = load('src/lib/fonts.ts').fontVars(model.activeTheme(adopted).fonts)
  assert.equal(after['font-sans'], before['font-sans'])
  assert.equal(after['font-serif'], before['font-serif'])
})
test('my-custom模板保存、JSON重载、采用保持精确身份与完整设计', () => {
  const created = themes.saveTheme(base('switch'), {name: 'my-custom', overrides: {main: '#663399'}, fonts: [{family: 'Noto Sans SC', role: 'sans'}]})
  const saved = templates.saveTemplate(created.workspace, {name: '桌面快照'}).workspace
  const restored = store.migrate(clone(saved))
  assert.equal(restored.templates[0].snapshot.theme.id, created.theme.id)
  assert.deepEqual(restored.templates[0].snapshot.theme, created.theme)
  const adopted = templates.applyTemplate(themes.applyTheme(restored, 'ios').workspace, restored.templates[0].id).workspace
  assert.deepEqual(model.activeTheme(adopted), created.theme)
  assert.equal(adopted.themes.filter(theme => theme.id === created.theme.id).length, 1)
  // 同色不同实现不能被错误查重，键顺序不同不创建重复主题。
  assert.equal(store.readTemplates(clone(saved.templates))[0].snapshot.theme.shell, 'switch')
})
test('模板查重比较实现与完整设计，忽略变量键顺序，库满原子失败', () => {
  const created = themes.saveTheme(base('switch'), {name: 'my-custom', overrides: {main: '#663399', radius: '4px'}, recipes: {button: {radius: 9}}, shellConfig: {coverScale: 110}})
  const saved = templates.saveTemplate(created.workspace, {name: '快照'}).workspace
  const reordered = clone(saved)
  reordered.themes.find(theme => theme.id === created.theme.id).overrides = Object.fromEntries(Object.entries(created.theme.overrides).reverse())
  const reused = templates.applyTemplate(reordered, saved.templates[0].id).workspace
  assert.equal(reused.themes.length, saved.themes.length)
  const different = clone(saved)
  Object.assign(different.themes.find(theme => theme.id === created.theme.id), {skin: 'paper', shell: 'standard'})
  const adopted = templates.applyTemplate(different, saved.templates[0].id).workspace
  assert.equal(model.activeTheme(adopted).shell, 'switch')
  assert.notEqual(adopted.theme.active, created.theme.id)
  while (different.themes.length < model.MAX_THEMES) different.themes.push({...clone(created.theme), id: `filler-${different.themes.length}`, name: `填充${different.themes.length}`})
  const before = clone(different)
  assert.throws(() => templates.applyTemplate(different, saved.templates[0].id), /主题库满/)
  assert.deepEqual(different, before)
})
test('主题编辑undo/redo保留完整快照，非法输入不会产生历史记录', () => {
  const initial = base('win98')
  store.commit(initial)
  const changed = themes.tweakTheme(store.getWorkspace(), {overrides: {main: '#663399'}}).workspace
  store.commit(changed)
  store.undo(); assert.deepEqual(store.getWorkspace(), initial)
  store.redo(); assert.deepEqual(store.getWorkspace(), changed)
  const before = store.getWorkspace()
  assert.throws(() => store.commit(themes.tweakTheme(before, {overrides: {main: 'red;'}}).workspace))
  assert.equal(store.getWorkspace(), before)
  store.undo(); assert.deepEqual(store.getWorkspace(), initial)
})
test('严格主题边界拒绝缺失身份、非法实现组合、字体、来源与模板内容', () => {
  const valid = themes.saveTheme(base('ios'), {name: '合法'}).theme
  const bad = [
    {...valid, skin: undefined}, {...valid, shell: 'win98'}, {...valid, fonts: [{family: 'bad;'}]},
    {...valid, origin: {definitionId: 'ios', version: 0}}, {...valid, overrides: {main: 'red; color:blue'}},
    {...model.IOS_THEME, skin: 'switch', shell: 'switch'}, {...model.IOS_THEME, builtin: false}, {...valid, builtin: true},
  ]
  for (const theme of bad) {
    assert.throws(() => themes.assertThemeEntry(theme))
    assert.throws(() => themes.assertWorkspaceThemes({...base(), themes: [theme]}))
    assert.throws(() => themes.assertWorkspaceThemes({...base(), templates: [{snapshot: {theme}}]}))
  }
  assert.throws(() => themes.tweakTheme(base(), {overrides: null, fonts: [{family: 'bad;'}]}))
})
test('显式字体角色接管旧造型字体，当前显式变量仍可有意覆盖', () => {
  for (const id of ['default', 'ios', 'pixel', 'switch', 'win98']) {
    const fonts = [{family: 'Noto Serif SC', role: 'sans'}]
    const changed = themes.tweakTheme(base(id), {fonts}).workspace
    const saved = themes.saveTheme(base(id), {name: '字体变体', fonts}).theme
    for (const theme of [model.activeTheme(changed), saved]) for (const mode of ['light', 'dark']) {
      const resolved = themes.resolveTheme(theme, mode)
      assert.ok(resolved.values['font-sans'].startsWith("'Noto Serif SC'"), `${id} 字体角色必须生效`)
      assert.equal(resolved.sources['font-sans'], 'font')
    }
    const explicit = themes.tweakTheme(base(id), {fonts, overrides: {'font-sans': 'system-ui'}}).workspace
    assert.equal(themes.resolveTheme(model.activeTheme(explicit), 'light').values['font-sans'], 'system-ui')
    assert.equal(themes.resolveTheme(model.activeTheme(explicit), 'light').sources['font-sans'], 'shared')
  }
})
test('普通对象原型同名ID也是合法自定义身份', () => {
  const result = themes.saveTheme(base('ios'), {name: 'constructor'})
  assert.equal(result.theme.id, 'constructor')
  for (const id of ['constructor', 'toString', '__proto__']) {
    const entry = {...result.theme, id}
    themes.assertThemeEntry(entry)
    assert.equal(themes.readThemes([entry]).find(theme => theme.id === id)?.skin, 'ios')
  }
})
test('入站容量包含自动补齐的内置主题，合法库往返不丢自定义身份', () => {
  const source = themes.saveTheme(base('ios'), {name: '独立方案'}).theme
  const custom = Array.from({length: model.MAX_THEMES - 5}, (_, n) => ({...source, id: `custom-${n}`}))
  themes.assertWorkspaceThemes({...base(), themes: custom})
  assert.deepEqual(themes.readThemes(custom).filter(theme => !theme.builtin).map(theme => theme.id), custom.map(theme => theme.id))
  const overflow = [...custom, {...source, id:'overflow'}]
  assert.throws(() => themes.assertWorkspaceThemes({...base(), themes: overflow}))
})
test('缺包与未知renderer完整设计经模板保存/重载/应用保留请求并安全回退', () => {
  const dependency = {packageId: 'test.unavailable', version: '1.0.0', digest: 'a'.repeat(64), themeId: 'future'}
  const theme = {id: 'future-custom', name: '未来设计', description: '缺包不删除', skin: 'future-skin', shell: 'future-shell', overrides: {radius: '8px'}, fonts: [], packageRef: dependency, rendererContract: {schemaVersion: 1, skinVersion: 2, shellVersion: 2}}
  const workspace = base(); workspace.themes.push(theme); workspace.theme.active = theme.id
  const saved = templates.saveTemplate(workspace, {name: '保留依赖'}).workspace
  const restored = store.migrate(clone(saved))
  assert.deepEqual(model.activeTheme(restored), theme)
  assert.deepEqual(restored.templates[0].snapshot.theme, theme)
  const applied = templates.applyTemplate(restored, restored.templates[0].id).workspace
  assert.deepEqual(model.activeTheme(applied), theme)
  assert.equal(themes.resolveTheme(model.activeTheme(applied), 'light').skin, 'paper')
  assert.equal(applied.theme.active, theme.id)
})
console.log(`主题身份回归：${passed}/${passed + failures.length}`)
if (failures.length) process.exitCode = 1
