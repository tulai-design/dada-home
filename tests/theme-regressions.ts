import baseCss from '../src/styles.css?raw'
import themeCss from '../src/theme.css?raw'
import {registerComponent} from '../src/lib/registry'
import {defaultWorkspace} from '../src/lib/ops'
import {applyTheme, readThemes, resolveThemeOverrides, saveTheme, setMode, swatch, tweakTheme} from '../src/lib/themes'
import {activeTheme, type ThemeEntry, type Workspace} from '../src/lib/workspace'
import {migrate, readTemplates} from '../src/lib/workspaceStore'
import {applyTemplate, saveTemplate, snapshotOf} from '../src/lib/templates'
import {findPreset} from '../src/lib/presets'
import {getAppearance} from '../src/lib/appearance'

// 仅主题测试所需的空组件定义；不挂载应用，不启动订阅、网络或存储副作用。
for (const type of ['clock', 'search', 'links', 'todos', 'note', 'bookmarks', 'feeds'] as const) {
  registerComponent({type, name: type, description: '', category: 'info', defaultConfig: {}, configSchema: {}, defaultSpan: 'full', component: () => null})
}

const output = document.querySelector<HTMLPreElement>('#results')!
const results: string[] = []
let failures = 0
function assert(value: unknown, message = '断言失败'): asserts value { if (!value) throw new Error(message) }
function same(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)}；预期 ${JSON.stringify(expected)}`) }
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); results.push(`通过：${name}`) } catch (error) { failures += 1; results.push(`失败：${name} — ${String(error)}`) }
  output.textContent = results.join('\n')
}

const dualInput = {
  name: '双模式海蓝',
  mode: 'dark',
  overrides: {radius: '12px', frame: '0px'},
  light: {bg: '#eef5ff', bg2: '#dfeafa', text: '#132a44', main: '#1264ba'},
  dark: {bg: '#102032', bg2: '#192f47', text: '#e5f1ff', main: '#70b2ff'},
}
const dualWorkspace = () => saveTheme(defaultWorkspace(), dualInput).workspace

await test('真实迁移后的默认工作区不误报外观差异', () => {
  const ws = migrate(JSON.parse(JSON.stringify(defaultWorkspace())))
  assert(ws, '默认工作区应能完成真实迁移')
  const report = getAppearance(ws)
  same(report.differences.theme, false)
  same(report.differences.dock, false)
  for (const page of report.differences.pages) {
    same(page.wallpaper, false)
    same(page.layers, false)
    same(page.css, false)
    same(page.componentLooks, [])
    same(page.embeddedVisuals, [])
  }
})
await test('双模式分别解析颜色，共享尺寸保留', () => {
  const theme = activeTheme(dualWorkspace())
  same(resolveThemeOverrides(theme, 'light').bg, dualInput.light.bg)
  same(resolveThemeOverrides(theme, 'dark').bg, dualInput.dark.bg)
  same(resolveThemeOverrides(theme, 'light').radius, '12px')
  same(resolveThemeOverrides(theme, 'dark').frame, '0px')
})
await test('手动切模式不改变主题定义，重载保留用户选择', () => {
  const initial = dualWorkspace()
  same(initial.theme.mode, 'dark')
  const light = setMode(initial, 'light')
  same(activeTheme(light), activeTheme(initial))
  const reloaded = migrate(JSON.parse(JSON.stringify(light)))!
  same(reloaded.theme.mode, 'light')
  same(activeTheme(reloaded).light, dualInput.light)
  same(activeTheme(reloaded).dark, dualInput.dark)
})
await test('旧深色主题迁移后浅色恢复基础，结构变量保留', () => {
  const legacy = readThemes([{id: 'legacy', name: '旧深色', description: '', mode: 'dark', overrides: {bg: '#071421', text: '#edf6ff', radius: '9px'}}])[1]
  same(resolveThemeOverrides(legacy, 'dark').bg, '#071421')
  assert(resolveThemeOverrides(legacy, 'light').bg !== '#071421')
  same(resolveThemeOverrides(legacy, 'light').radius, '9px')
})
await test('旧主题未写 mode 时根据深色背景归属夜间分支', () => {
  const legacy = readThemes([{id: 'legacy-auto', name: '未标模式', overrides: {bg: '#102030', text: '#e8f4ff', main: '#4da9ff'}}])[1]
  same(legacy.mode, 'dark')
  same(resolveThemeOverrides(legacy, 'dark').bg, '#102030')
  assert(resolveThemeOverrides(legacy, 'light').bg !== '#102030')
  const ws = {...defaultWorkspace(), themes: [defaultWorkspace().themes[0], legacy]}
  const applied = applyTheme(ws, legacy.id).workspace
  same(applied.theme.mode, 'dark')
  same(migrate(JSON.parse(JSON.stringify(setMode(applied, 'light'))))!.theme.mode, 'light')
})
await test('改名和共享外观不丢两套颜色，也不重新激活模式', () => {
  let ws = setMode(dualWorkspace(), 'light')
  ws = saveTheme(ws, {id: ws.theme.active, name: '改名海蓝', description: '已改名', activate: false}).workspace
  ws = tweakTheme(ws, {overrides: {frame: '4px'}}).workspace
  same(ws.theme.mode, 'light')
  same(activeTheme(ws).light, dualInput.light)
  same(activeTheme(ws).dark, dualInput.dark)
  same(resolveThemeOverrides(activeTheme(ws), 'dark').frame, '4px')
})
await test('模式分支省略时保留，空对象与 null 只清指定分支', () => {
  const ws = dualWorkspace()
  const clearedLight = saveTheme(ws, {id: ws.theme.active, light: {}, activate: false}).workspace
  same(Object.keys(activeTheme(clearedLight).light ?? {}).length, 0)
  same(activeTheme(clearedLight).dark, dualInput.dark)
  const clearedDark = saveTheme(ws, {id: ws.theme.active, dark: null, activate: false}).workspace
  same(Object.keys(activeTheme(clearedDark).dark ?? {}).length, 0)
  same(activeTheme(clearedDark).light, dualInput.light)
})
await test('主题缩略色块与当前模式一致', () => {
  const theme = activeTheme(dualWorkspace())
  same(swatch(theme, 'light').bg, dualInput.light.bg)
  same(swatch(theme, 'dark').bg, dualInput.dark.bg)
})
await test('模板深拷贝保存两套配色，导入读取不丢字段', () => {
  const ws = dualWorkspace()
  const saved = saveTemplate(ws, {name: '主题模板'}).template
  const loaded = readTemplates(JSON.parse(JSON.stringify([saved])))
  same(loaded[0].snapshot.theme?.light, dualInput.light)
  same(loaded[0].snapshot.theme?.dark, dualInput.dark)
  assert(saved.snapshot.theme !== activeTheme(ws), '快照应独立于主题对象')
  assert(!snapshotOf(ws, false).theme, '不带主题的模板不应保存配色')
})
await test('模式颜色不同的同名模板主题不能复用旧主题', () => {
  const ws = dualWorkspace()
  const saved = saveTemplate(ws, {name: '原主题'}).workspace
  const original = activeTheme(saved)
  const changed: ThemeEntry = {...original, dark: {...original.dark, bg: '#010a13'}}
  const alternate: Workspace = {...saved, templates: [{...saved.templates[0], snapshot: {...saved.templates[0].snapshot, theme: changed}}]}
  const applied = applyTemplate(alternate, alternate.templates[0].id).workspace
  same(applied.themes.length, saved.themes.length + 1)
  same(activeTheme(applied).dark?.bg, '#010a13')
  same(original.dark?.bg, dualInput.dark.bg)
})
await test('完全相同的模板主题复用已有条目', () => {
  const ws = saveTemplate(dualWorkspace(), {name: '一致主题'}).workspace
  const applied = applyTemplate(ws, ws.templates[0].id).workspace
  same(applied.themes.length, ws.themes.length)
  same(applied.theme.active, ws.theme.active)
})
await test('内置深夜工作台有完整的日间与夜间配色', () => {
  const preset = findPreset('preset-night')!.build()
  assert(preset.theme?.light?.bg && preset.theme.dark?.bg)
  assert(preset.theme.light.bg !== preset.theme.dark.bg)
  same(preset.theme.mode, 'dark')
})

const frame = document.createElement('iframe')
frame.title = '隔离主题样式验证'
frame.setAttribute('sandbox', 'allow-same-origin')
frame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none'
// 字体 URL 的权重参数也含分号，不能按第一个分号截断 @import，否则会吞掉后面的 :root 规则。
const isolatedCss = `${baseCss}\n${themeCss}`.replace(/@import\s+url\((?:"[^"]*"|'[^']*'|[^)])*\)\s*;/g, '')
const frameReady = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), {once: true}))
frame.srcdoc = `<!doctype html><html><head><style>${isolatedCss}</style></head><body><div id="probe" style="background:var(--bg);color:var(--text)">主题测试</div><div id="lobe" style="background:var(--lobe-color-bg-elevated);color:var(--lobe-color-text)">弹层测试</div></body></html>`
document.body.append(frame)
// 等待 srcdoc 文档稳定，避免初始 about:blank 加载替换已写入的文档。
await frameReady
const doc = frame.contentDocument!
let appliedVars: string[] = []
function paint(theme: ThemeEntry, mode: 'light' | 'dark') {
  const root = doc.documentElement
  root.dataset.theme = mode
  for (const key of appliedVars) root.style.removeProperty(`--${key}`)
  const vars = resolveThemeOverrides(theme, mode)
  appliedVars = Object.keys(vars)
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(`--${key}`, value)
  return {root: frame.contentWindow!.getComputedStyle(root), probe: frame.contentWindow!.getComputedStyle(doc.querySelector('#probe')!), lobe: frame.contentWindow!.getComputedStyle(doc.querySelector('#lobe')!)}
}
await test('真实 CSS：深浅色背景、文字、弹层和 color-scheme 同步', () => {
  const theme = activeTheme(dualWorkspace())
  const light = paint(theme, 'light')
  same(light.probe.backgroundColor, 'rgb(238, 245, 255)')
  same(light.probe.color, 'rgb(19, 42, 68)')
  same(light.lobe.backgroundColor, 'rgb(238, 245, 255)')
  same(light.lobe.color, 'rgb(19, 42, 68)')
  same(light.root.colorScheme, 'light')
  const dark = paint(theme, 'dark')
  same(dark.probe.backgroundColor, 'rgb(16, 32, 50)')
  same(dark.probe.color, 'rgb(229, 241, 255)')
  same(dark.lobe.backgroundColor, 'rgb(25, 47, 71)')
  same(dark.lobe.color, 'rgb(229, 241, 255)')
  same(dark.root.colorScheme, 'dark')
})
await test('真实 CSS：旧主题切浅色后不残留夜间内联颜色', () => {
  const legacy = readThemes([{id: 'legacy', name: '旧深色', mode: 'dark', overrides: {bg: '#071421', text: '#edf6ff'}}])[1]
  same(paint(legacy, 'dark').probe.backgroundColor, 'rgb(7, 20, 33)')
  const light = paint(legacy, 'light')
  same(light.probe.backgroundColor, 'rgb(244, 240, 230)')
  same(light.probe.color, 'rgb(28, 24, 21)')
})
frame.remove()
results.push(`\n${failures ? '失败' : '全部通过'}：${results.length - failures}/${results.length}`)
output.textContent = results.join('\n')
document.documentElement.dataset.result = failures ? 'failed' : 'passed'
