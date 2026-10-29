import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

// 执行真实主题与迁移代码，外围组件注册隔离；不依赖 DOM、不读写用户存储。
const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map()
const mocks = new Map()
function load(relative) {
  const file = path.resolve(root, relative)
  if (mocks.has(file)) return mocks.get(file)
  if (cache.has(file)) return cache.get(file).exports
  const module = {exports: {}}
  cache.set(file, module)
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText
  const require = (id) => {
    if (id === 'react') return {useCallback: (fn) => fn, useSyncExternalStore() {}}
    assert.ok(id.startsWith('.'), `未隔离的外部依赖：${id}`)
    return load(path.resolve(path.dirname(file), `${id}.ts`))
  }
  vm.runInThisContext(`(function(module, exports, require) {${compiled}\n})`, {filename: file})(module, module.exports, require)
  return module.exports
}
const model = load('src/lib/workspace.ts')
const themes = load('src/lib/themes.ts')
const {DEFAULT_THEME, DEFAULT_THEME_ID, IOS_THEME, IOS_THEME_ID, PIXEL_THEME, PIXEL_THEME_ID, SWITCH_THEME, SWITCH_THEME_ID, activeTheme} = model
const {saveTheme, tweakTheme, applyTheme, setMode, setSkinFrame, readThemes, removeTheme, resolveThemeOverrides, swatch} = themes
const base = () => ({
  version: model.WORKSPACE_VERSION,
  pages: [{id: model.FROZEN_PAGE_ID, name: '首页', label: '首页', components: []}],
  statusbar: [], addons: [], widgets: [], network: [], templates: [],
  layout: {columns: 12, maxWidth: 1440},
  theme: {active: DEFAULT_THEME_ID, mode: 'light', base: 'light'}, themes: [DEFAULT_THEME],
})
mocks.set(path.resolve(root, 'src/lib/ops.ts'), {defaultWorkspace: base})
mocks.set(path.resolve(root, 'src/lib/registry.ts'), {getDefinition: () => undefined, normalizeConfig: (_definition, config) => config})
mocks.set(path.resolve(root, 'src/fx/catalog.ts'), {normalizeLayer: () => {throw new Error('测试中没有特效')}})
mocks.set(path.resolve(root, 'src/lib/pageIcons.ts'), {isPageIcon: () => false})
mocks.set(path.resolve(root, 'src/lib/dock.ts'), {readDock: () => undefined})
mocks.set(path.resolve(root, 'src/lib/market.ts'), {ADDONS: []})
const {migrate} = load('src/lib/workspaceStore.ts')
const palette = {
  light: {bg: '#f3f7fc', bg2: '#e8eff8', text: '#15263f', text2: '#42536c', main: '#1464bd'},
  dark: {bg: '#0c1828', bg2: '#15263f', text: '#e4efff', text2: '#b6c5dc', main: '#65aaff'},
}
function dual() {
  return saveTheme(base(), {name: '海岸', overrides: {frame: '0px', radius: '8px'}, ...palette}).workspace
}
const failures = []
let count = 0
function test(name, fn) {
  count += 1
  try { fn(); console.log(`通过：${name}`) }
  catch (error) { failures.push(name); console.error(`失败：${name}\n${error.stack}`) }
}

test('双模式主题切换使用各自的背景、文字和主色，共享布局保持', () => {
  const ws = dual()
  const light = resolveThemeOverrides(activeTheme(setMode(ws, 'light')), 'light')
  const dark = resolveThemeOverrides(activeTheme(setMode(ws, 'dark')), 'dark')
  assert.equal(light.bg, palette.light.bg)
  assert.equal(dark.bg, palette.dark.bg)
  assert.equal(light.text, palette.light.text)
  assert.equal(dark.text, palette.dark.text)
  assert.equal(light.main, palette.light.main)
  assert.equal(dark.main, palette.dark.main)
  assert.equal(light.frame, '0px')
  assert.equal(dark.radius, '8px')
})
test('旧固定深色主题归入深色分支，浅色回落系统配色', () => {
  const old = {id: 'legacy-dark', name: '旧深色', description: '', mode: 'dark', overrides: {bg: '#111827', text: '#f8fafc', border: '#334155', main: '#60a5fa', frame: '0px'}}
  const entry = readThemes([old]).find((item) => item.id === old.id)
  assert.equal(resolveThemeOverrides(entry, 'dark').bg, '#111827')
  assert.notEqual(swatch(entry, 'light').bg, '#111827')
  assert.notEqual(swatch(entry, 'light').text, '#f8fafc')
  assert.equal(resolveThemeOverrides(entry, 'light').frame, '0px')
  assert.equal(resolveThemeOverrides(entry, 'light').main, '#60a5fa')
})
test('旧主题未声明模式时能从深色十六进制背景判断归属', () => {
  const entry = readThemes([{id: 'inferred', name: '无模式深色', overrides: {bg: '#101820', text: '#f3f7fc'}}]).find((item) => item.id === 'inferred')
  assert.equal(resolveThemeOverrides(entry, 'dark').bg, '#101820')
  assert.notEqual(swatch(entry, 'light').bg, '#101820')
})
test('旧共享主色、外框、字体变量继续跨模式生效', () => {
  const entry = readThemes([{id: 'shared', name: '共用', overrides: {main: '#a855f7', frame: '3px', 'font-serif': 'Georgia, serif'}}]).find((item) => item.id === 'shared')
  for (const mode of ['light', 'dark']) {
    const vars = resolveThemeOverrides(entry, mode)
    assert.equal(vars.main, '#a855f7')
    assert.equal(vars.frame, '3px')
    assert.equal(vars['font-serif'], 'Georgia, serif')
  }
})
test('新建旧格式主题的固定底色仅作用指定模式', () => {
  const {theme} = saveTheme(base(), {name: '旧工具输入', mode: 'dark', overrides: {bg: '#132032', text: '#f3f7fc', main: '#67b0ff', frame: '0px'}})
  assert.equal(resolveThemeOverrides(theme, 'dark').bg, '#132032')
  assert.notEqual(swatch(theme, 'light').bg, '#132032')
  assert.equal(resolveThemeOverrides(theme, 'light').main, '#67b0ff')
})
test('改名与修改说明不会丢失双模式配色或改变当前模式', () => {
  const initial = setMode(dual(), 'dark')
  const result = saveTheme(initial, {id: initial.theme.active, name: '海岸新版', description: '更新说明', activate: false})
  assert.equal(result.workspace.theme.mode, 'dark')
  assert.deepEqual(result.theme.light, palette.light)
  assert.deepEqual(result.theme.dark, palette.dark)
})
test('更新当前主题默认启用时保留手选模式，显式mode仍可切换', () => {
  const created = saveTheme(base(), {name: '偏好深色', mode: 'dark', ...palette})
  const selected = setMode(created.workspace, 'light')
  const renamed = saveTheme(selected, {id: created.theme.id, name: '偏好深色新版'})
  assert.equal(renamed.workspace.theme.mode, 'light')
  assert.equal(renamed.theme.mode, 'dark')
  const updated = saveTheme(renamed.workspace, {id: created.theme.id, dark: {bg: '#101c30'}})
  assert.equal(updated.workspace.theme.mode, 'light')
  assert.equal(updated.theme.dark.bg, '#101c30')
  const explicit = saveTheme(updated.workspace, {id: created.theme.id, mode: 'dark'})
  assert.equal(explicit.workspace.theme.mode, 'dark')
  const fromDefault = applyTheme(selected, DEFAULT_THEME_ID).workspace
  const activatedOther = saveTheme(fromDefault, {id: created.theme.id, description: '从默认切入'})
  assert.equal(activatedOther.workspace.theme.mode, 'dark')
})
test('保存字体后可清空字体，同时保留双模式配色', () => {
  let ws = dual()
  ws = saveTheme(ws, {id: ws.theme.active, fonts: [{family: 'Noto Sans SC', role: 'sans'}], activate: false}).workspace
  assert.equal(activeTheme(ws).fonts.length, 1)
  ws = saveTheme(ws, {id: ws.theme.active, fonts: [], activate: false}).workspace
  assert.equal(activeTheme(ws).fonts?.length ?? 0, 0)
  assert.deepEqual(activeTheme(ws).light, palette.light)
  assert.deepEqual(activeTheme(ws).dark, palette.dark)
})
test('保存指定分支替换整套变量，未提供的另一分支保留', () => {
  const ws = dual()
  const next = saveTheme(ws, {id: ws.theme.active, light: {bg: '#fffdfa'}, activate: false}).theme
  assert.deepEqual(next.light, {bg: '#fffdfa'})
  assert.deepEqual(next.dark, palette.dark)
})
test('保存分支传空对象或null可清空，不残留旧颜色', () => {
  const ws = dual()
  const next = saveTheme(ws, {id: ws.theme.active, light: {}, dark: null, activate: false}).theme
  assert.equal(Object.keys(next.light ?? {}).length, 0)
  assert.equal(Object.keys(next.dark ?? {}).length, 0)
  assert.notEqual(swatch(next, 'light').bg, palette.light.bg)
  assert.notEqual(swatch(next, 'dark').bg, palette.dark.bg)
})
test('旧格式微调只更新当前模式，另一模式原有颜色不变', () => {
  const ws = setMode(dual(), 'dark')
  const next = tweakTheme(ws, {overrides: {bg: '#18253a', text: '#ffffff', frame: '2px'}}).workspace
  assert.equal(resolveThemeOverrides(activeTheme(next), 'dark').bg, '#18253a')
  assert.equal(resolveThemeOverrides(activeTheme(next), 'light').bg, palette.light.bg)
  assert.equal(resolveThemeOverrides(activeTheme(next), 'light').frame, '2px')
})
test('显式双模式微调合并分支，不清掉未修改变量', () => {
  const ws = dual()
  const next = activeTheme(tweakTheme(ws, {light: {bg: '#ffffff'}, dark: {bg: '#080c14'}}).workspace)
  assert.equal(next.light.bg, '#ffffff')
  assert.equal(next.dark.bg, '#080c14')
  assert.equal(next.light.text, palette.light.text)
  assert.equal(next.dark.text, palette.dark.text)
})
test('微调null清除指定分支，全部重置同时清配色与字体', () => {
  let ws = dual()
  ws = tweakTheme(ws, {light: null}).workspace
  assert.equal(Object.keys(activeTheme(ws).light ?? {}).length, 0)
  assert.deepEqual(activeTheme(ws).dark, palette.dark)
  ws = saveTheme(ws, {id: ws.theme.active, fonts: [{family: 'Noto Sans SC'}], activate: false}).workspace
  ws = tweakTheme(ws, {overrides: null}).workspace
  const entry = activeTheme(ws)
  assert.deepEqual(entry.overrides, {})
  assert.equal(Object.keys(entry.light ?? {}).length, 0)
  assert.equal(Object.keys(entry.dark ?? {}).length, 0)
  assert.equal(entry.fonts?.length ?? 0, 0)
})
test('默认主题上添加双模式会另存，不修改默认主题', () => {
  const ws = base()
  const before = JSON.stringify(DEFAULT_THEME)
  const next = tweakTheme(ws, {...palette}).workspace
  assert.notEqual(next.theme.active, DEFAULT_THEME_ID)
  assert.deepEqual(activeTheme(next).light, palette.light)
  assert.equal(JSON.stringify(DEFAULT_THEME), before)
})
test('无效模式或配色原子失败，不修改已有工作空间', () => {
  const ws = dual()
  const before = JSON.stringify(ws)
  assert.throws(() => saveTheme(ws, {id: ws.theme.active, mode: 'auto', light: {bg: '#fff'}}))
  assert.throws(() => saveTheme(ws, {id: ws.theme.active, dark: {bg: '#000;display:none'}}))
  assert.throws(() => tweakTheme(ws, {mode: 'dark', light: []}))
  assert.throws(() => tweakTheme(ws, {dark: {bg: 123}}))
  assert.equal(JSON.stringify(ws), before)
})
test('保存和读取两套配色可往返，损坏条目不污染主题库', () => {
  const ws = dual()
  const loaded = readThemes([...JSON.parse(JSON.stringify(ws.themes)), {id: 'bad', name: '坏数据', overrides: {}, light: {bg: {}}}])
  const entry = loaded.find((item) => item.id === ws.theme.active)
  assert.deepEqual(entry.light, palette.light)
  assert.deepEqual(entry.dark, palette.dark)
  assert.ok(!loaded.some((item) => item.id === 'bad'))
})
test('刷新迁移保留用户当前浅色选择，不用主题初始深色覆盖', () => {
  const result = saveTheme(base(), {name: '初始深色', mode: 'dark', ...palette})
  const selected = setMode(result.workspace, 'light')
  const loaded = migrate(JSON.parse(JSON.stringify(selected)))
  assert.equal(loaded.theme.mode, 'light')
  assert.equal(loaded.theme.base, 'light')
  assert.equal(activeTheme(loaded).mode, 'dark')
  assert.deepEqual(activeTheme(loaded).light, palette.light)
  assert.equal(resolveThemeOverrides(activeTheme(loaded), loaded.theme.mode).bg, palette.light.bg)
})
test('更旧的theme.overrides能迁移且不把深色背景锁到浅色', () => {
  const ws = base()
  delete ws.themes
  ws.theme = {mode: 'dark', overrides: {bg: '#111827', text: '#f8fafc', frame: '0px'}}
  const loaded = migrate(ws)
  const entry = activeTheme(loaded)
  assert.equal(resolveThemeOverrides(entry, 'dark').bg, '#111827')
  assert.notEqual(swatch(entry, 'light').bg, '#111827')
  assert.equal(resolveThemeOverrides(entry, 'light').frame, '0px')
})
test('应用主题的初始偏好只影响应用动作，手动切换保持可用', () => {
  const result = saveTheme(base(), {name: '夜航', mode: 'dark', ...palette})
  assert.equal(result.workspace.theme.mode, 'dark')
  const manual = setMode(result.workspace, 'light')
  assert.equal(manual.theme.mode, 'light')
  assert.equal(activeTheme(manual).mode, 'dark')
  const appliedAgain = applyTheme(manual, result.theme.id).workspace
  assert.equal(appliedAgain.theme.mode, 'dark')
  assert.equal(manual.theme.base, 'light')
})

test('iOS 是内置预设，读入时覆盖同 id 旧副本，不能改删', () => {
  const loaded = readThemes([{id: 'ios', name: '旧', description: '', overrides: {}, light: {main: '#ff00ff'}}])
  assert.equal(loaded[0].id, DEFAULT_THEME_ID)
  assert.equal(loaded[1].id, IOS_THEME_ID)
  assert.equal(loaded[1].light.main, IOS_THEME.light.main)
  assert.equal(loaded.filter((item) => item.id === 'ios').length, 1)
  const ws = {...base(), themes: loaded}
  assert.equal(applyTheme(ws, 'ios').workspace.theme.active, IOS_THEME_ID)
  assert.throws(() => removeTheme(ws, 'ios'), /内置主题不能删除/)
  assert.throws(() => saveTheme(ws, {id: 'ios', name: '改掉'}), /内置主题不能修改/)
})

test('掌机是内置预设，读入时覆盖同 id 旧副本，不能改删', () => {
  const loaded = readThemes([{id: 'pixel', name: '旧', description: '', overrides: {}, light: {main: '#ff00ff'}}])
  assert.equal(loaded[0].id, DEFAULT_THEME_ID)
  assert.equal(loaded[1].id, IOS_THEME_ID)
  assert.equal(loaded[2].id, PIXEL_THEME_ID)
  assert.equal(loaded[2].light.main, PIXEL_THEME.light.main)
  assert.equal(loaded[2].light.bg, '#c5d2ae')
  assert.equal(loaded[2].dark.bg, '#1a2218')
  assert.equal(loaded.filter((item) => item.id === 'pixel').length, 1)
  const ws = {...base(), themes: loaded}
  assert.equal(applyTheme(ws, 'pixel').workspace.theme.active, PIXEL_THEME_ID)
  assert.throws(() => removeTheme(ws, 'pixel'), /内置主题不能删除/)
  assert.throws(() => saveTheme(ws, {id: 'pixel', name: '改掉'}), /内置主题不能修改/)
  const off = setSkinFrame(applyTheme({...base(), themes: loaded}, 'pixel').workspace, false)
  assert.equal(off.theme.active, PIXEL_THEME_ID)
  assert.equal(off.theme.frameOff, true)
  assert.equal(off.themes.some((item) => item.name.startsWith('自定义')), false)
  assert.equal(setSkinFrame(off, true).theme.frameOff, undefined)
  assert.equal(setSkinFrame(base(), false).theme.frameOff, undefined)
  assert.equal(applyTheme(off, 'ios').workspace.theme.frameOff, undefined)
})

test('主机是内置预设，读入时覆盖同 id 旧副本，不能改删', () => {
  const loaded = readThemes([{id: 'switch', name: '旧', description: '', overrides: {}, dark: {main: '#ff00ff'}}])
  assert.equal(loaded[0].id, DEFAULT_THEME_ID)
  assert.equal(loaded[1].id, IOS_THEME_ID)
  assert.equal(loaded[2].id, PIXEL_THEME_ID)
  assert.equal(loaded[3].id, SWITCH_THEME_ID)
  assert.equal(loaded[3].dark.main, SWITCH_THEME.dark.main)
  assert.equal(loaded[3].dark.bg, SWITCH_THEME.dark.bg)
  const day = resolveThemeOverrides(loaded[3], 'light')
  const night = resolveThemeOverrides(loaded[3], 'dark')
  assert.notEqual(day.bg, night.bg, '主机浅色与深色必须使用不同背景')
  assert.notEqual(day.text, night.text, '文字随明暗模式适配')
  assert.equal(day['switch-orb'], day.bg2, '浅色圆形入口使用浅色表面')
  assert.equal(day['font-serif'], 'var(--font-sans)', '主机内容沿用系统无衬线字体')
  assert.equal(loaded.filter((item) => item.id === 'switch').length, 1)
  const ws = {...base(), themes: loaded}
  assert.equal(applyTheme(ws, 'switch').workspace.theme.active, SWITCH_THEME_ID)
  assert.equal(applyTheme(ws, 'switch').workspace.theme.mode, 'dark')
  assert.throws(() => removeTheme(ws, 'switch'), /内置主题不能删除/)
  assert.throws(() => saveTheme(ws, {id: 'switch', name: '改掉'}), /内置主题不能修改/)
  const off = setSkinFrame(applyTheme(ws, 'switch').workspace, false)
  assert.equal(off.theme.active, SWITCH_THEME_ID)
  assert.equal(off.themes.some((item) => item.name.startsWith('自定义')), false)
})

console.log(`主题回归：${count - failures.length}/${count}`)
if (failures.length) process.exitCode = 1
