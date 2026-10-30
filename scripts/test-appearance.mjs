import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import ts from 'typescript'

// 外观函数只有纯数据依赖，加载真实源码即可，无 DOM、存储和额外测试依赖。
const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map()
function load(file) {
  const absolute = path.resolve(root, file)
  if (cache.has(absolute)) return cache.get(absolute).exports
  const module = {exports: {}}
  cache.set(absolute, module)
  const js = ts.transpileModule(readFileSync(absolute, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
  const require = (id) => {
    assert.ok(id.startsWith('.'), `外观纯函数出现未隔离依赖：${id}`)
    return load(path.resolve(path.dirname(absolute), `${id}.ts`))
  }
  new Function('module', 'exports', 'require', js)(module, module.exports, require)
  return module.exports
}
const {defaultAppearance, getAppearance, resetAppearance} = load('src/lib/appearance.ts')
const {DEFAULT_HOME_LAYERS, DEFAULT_THEME, DEFAULT_THEME_ID, IOS_THEME, IOS_THEME_ID, WORKSPACE_VERSION} = load('src/lib/workspace.ts')
const {DEFAULT_THEME_PALETTES} = load('src/lib/themes.ts')
const {DEFAULT_STACKS, fontVars} = load('src/lib/fonts.ts')
const clone = (value) => JSON.parse(JSON.stringify(value))
const fixture = () => ({
  version: WORKSPACE_VERSION,
  theme: {active: 'night', mode: 'dark', base: 'light'},
  themes: [DEFAULT_THEME, IOS_THEME, {skin: 'paper', shell: 'standard', id: 'night', name: '夜航', description: '自定义主题', overrides: {frame: '0px'}, dark: {bg: '#07111f', text: '#dcecff'}, fonts: [{family: 'Noto Sans SC', role: 'sans'}]}],
  layout: {columns: 9, maxWidth: 1234},
  widgets: [{id: 'custom-list', name: '自定义列表', source: {kind: 'static', items: [{title: '保留自定义数据'}]}}],
  network: [{host: 'example.com', grantedAt: 1}],
  statusbar: [{id: 'status-clock', type: 'clock', config: {showSeconds: true}}],
  addons: ['feeds', 'calendar'],
  templates: [{id: 'saved', name: '存下的设计', snapshot: {theme: {id: 'old', overrides: {frame: '2px'}}}}],
  template: 'saved',
  dock: {preset: 'solid', css: '&{background:purple}'},
  pages: [
    {
      id: 'home', name: '我的首页', label: '起点', icon: 'home', align: 'start',
      wallpaper: {mode: 'custom', url: 'https://example.com/wallpaper.jpg'}, layers: [{effect: 'aurora', params: {opacity: 0.8}}], css: 'background:purple;',
      components: [
        {id: 'clock-one', type: 'clock', title: '工作时钟', span: 'third', config: {align: 'left', showSeconds: true}, look: {variant: 'accent', tone: 'blue', titleSize: 'lg', css: 'color:pink;', animation: 'fade-in'}},
        {id: 'app-one', type: 'app', span: 'two-thirds', config: {html: '<p>自定义内容</p>', css: 'body{background:navy}', js: 'window.example=1', height: 320, data: ['保留配置']}, look: {css: 'border:0'}},
      ],
    },
    {
      id: 'desk', name: '书桌', label: '书桌', align: 'center',
      wallpaper: {mode: 'unsplash', index: 3}, layers: [{effect: 'noise', params: {opacity: 0.2}}], css: 'border-radius:30px;',
      components: [
        {id: 'fx-one', type: 'fx', title: '内容横幅', span: 'full', config: {effect: 'aurora', text: '作为内容的特效', params: {color: '#ff00ff'}, height: 100}, look: {tone: 'main'}},
        {id: 'todo-one', type: 'todos', span: 'half', config: {heading: '任务', data: [{text: '保持内容', done: false}]}},
      ],
    },
  ],
})
const withoutLook = ({look: _look, ...component}) => component
const checks = []
function test(name, run) {
  run()
  checks.push(name)
  console.log(`通过：${name}`)
}

test('默认查询包含iOS双模式、字体、无外框、玻璃Dock与默认首页波纹线', () => {
  const defaults = defaultAppearance()
  assert.equal(defaults.theme.id, IOS_THEME_ID)
  assert.deepEqual(defaults.theme.light, IOS_THEME.light)
  assert.deepEqual(defaults.theme.dark, IOS_THEME.dark)
  assert.deepEqual(defaults.theme.fonts, {...DEFAULT_STACKS, serif: fontVars(IOS_THEME.fonts)['font-serif']})
  assert.equal(defaults.theme.shared.frame, '0px')
  assert.equal(defaults.dock.preset, 'glass')
  assert.equal(defaults.home.wallpaper.mode, 'off')
  assert.deepEqual(defaults.home.layers, DEFAULT_HOME_LAYERS)
  assert.equal(defaults.home.layers[0].effect, 'waves')
  assert.match(defaults.resetPolicy.preserved, /App.*源码/)
})
test('默认说明的配色、字体和尺寸与CSS基底叠加iOS主题一致', () => {
  const styles = readFileSync(path.join(root, 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const theme = readFileSync(path.join(root, 'src/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const vars = (css, selector) => {
    const block = selector.exec(css)?.[1]
    assert.ok(block, `找不到默认变量块：${selector}`)
    return Object.fromEntries([...block.matchAll(/--([a-z][a-z0-9-]*)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
  }
  const rootSelector = /:root\s*\{([^}]+)\}/
  const darkSelector = /:root\[data-theme=['"]dark['"]\]\s*\{([^}]+)\}/
  const shared = {...vars(styles, rootSelector), ...vars(theme, rootSelector)}
  const dark = {...shared, ...vars(styles, darkSelector), ...vars(theme, darkSelector)}
  const defaults = defaultAppearance()
  for (const [mode, actual] of [['light', {...shared, ...IOS_THEME.overrides, ...IOS_THEME.light}], ['dark', {...dark, ...IOS_THEME.overrides, ...IOS_THEME.dark}]]) {
    for (const [name, value] of Object.entries(defaults.theme[mode])) assert.equal(value, actual[name], `${mode} 模式默认变量 --${name} 说明与CSS漂移`)
  }
  for (const [role, value] of Object.entries(defaults.theme.fonts)) assert.equal(value, fontVars(IOS_THEME.fonts)[`font-${role}`] ?? shared[`font-${role}`], `默认${role}字体说明与CSS漂移`)
  for (const [name, value] of Object.entries(defaults.theme.shared)) {
    if ((name === 'frame-gap' || name === 'frame-color') && !(name in IOS_THEME.overrides)) {
      // 这两个变量通过CSS var()缺省参数表达，未声明时分别跟随frame/main。
      assert.ok(theme.includes(`var(--${name}, ${value})`), `默认 --${name} 缺省引用与CSS漂移`)
    } else assert.equal(value, IOS_THEME.overrides[name] ?? shared[name], `共享默认变量 --${name} 说明与CSS漂移`)
  }
})
test('当前外观查询报告实际主题颜色、页面背景及独立视觉内容差异', () => {
  const ws = fixture()
  const before = clone(ws)
  const appearance = getAppearance(ws)
  assert.equal(appearance.current.theme.resolved.bg, '#07111f')
  assert.equal(appearance.current.theme.resolved.text, '#dcecff')
  assert.equal(appearance.current.theme.resolved.frame, '0px')
  assert.equal(appearance.current.theme.resolved.radius, '0px')
  assert.equal(appearance.current.theme.resolved['font-serif'], DEFAULT_STACKS.serif)
  assert.equal(appearance.current.theme.resolved['font-sans'], `'Noto Sans SC', ${DEFAULT_STACKS.sans}`)
  assert.equal(appearance.current.mode, 'dark')
  assert.equal(appearance.current.dock.preset, 'solid')
  assert.equal(appearance.differences.theme, true)
  assert.equal(appearance.differences.dock, true)
  const home = appearance.differences.pages.find((page) => page.id === 'home')
  assert.equal(home.wallpaper, true)
  assert.equal(home.layers, true)
  assert.equal(home.css, true)
  assert.deepEqual(home.componentLooks, ['clock-one', 'app-one'])
  assert.deepEqual(home.embeddedVisuals, ['app-one'])
  assert.deepEqual(appearance.differences.pages.find((page) => page.id === 'desk').embeddedVisuals, ['fx-one'])
  assert.deepEqual(ws, before)
})
test('全站恢复清除壁纸、页面CSS、图层与组件外观，首页恢复默认背景', () => {
  const ws = fixture()
  const restored = resetAppearance(ws)
  assert.equal(restored.theme.active, IOS_THEME_ID)
  assert.equal(restored.theme.mode, 'dark')
  assert.equal(restored.theme.base, 'dark')
  assert.equal(restored.dock, undefined)
  assert.deepEqual(restored.pages[0].layers, DEFAULT_HOME_LAYERS)
  assert.equal(restored.pages[1].layers, undefined)
  for (const page of restored.pages) {
    assert.equal(page.wallpaper, undefined)
    assert.equal(page.css, undefined)
    for (const component of page.components) assert.equal(component.look, undefined)
  }
  const report = getAppearance(restored)
  assert.equal(report.differences.theme, false)
  assert.equal(report.differences.dock, false)
  for (const page of report.differences.pages) {
    assert.equal(page.wallpaper, false)
    assert.equal(page.layers, false)
    assert.equal(page.css, false)
    assert.deepEqual(page.componentLooks, [])
  }
})
test('默认图层的对象键和参数顺序变化不会误报差异，实际参数变化仍能识别', () => {
  const ws = resetAppearance(fixture())
  const home = ws.pages.find((page) => page.id === 'home')
  home.layers = home.layers.map((layer) => ({
    params: Object.fromEntries(Object.entries(layer.params).reverse()),
    effect: layer.effect,
  }))
  const before = clone(ws)
  assert.notEqual(JSON.stringify(home.layers), JSON.stringify(DEFAULT_HOME_LAYERS), '测试应实际改变对象的序列化顺序')
  assert.equal(getAppearance(ws).differences.pages.find((page) => page.id === 'home').layers, false)
  assert.deepEqual(ws, before, '查询差异不能通过就地排序修改原数据')
  home.layers[0].params.opacity += 0.01
  assert.equal(getAppearance(ws).differences.pages.find((page) => page.id === 'home').layers, true)
})
test('恢复保留页面和组件身份、顺序、宽度、对齐、配置与全部数据结构', () => {
  const ws = fixture()
  const before = clone(ws)
  const restored = resetAppearance(ws)
  assert.deepEqual(ws, before, '原工作空间不得被就地修改')
  assert.deepEqual(restored.pages.map((page) => page.id), ws.pages.map((page) => page.id))
  for (let i = 0; i < ws.pages.length; i += 1) {
    const source = ws.pages[i]
    const target = restored.pages[i]
    assert.deepEqual([target.id, target.name, target.label, target.icon, target.align], [source.id, source.name, source.label, source.icon, source.align])
    assert.deepEqual(target.components, source.components.map(withoutLook))
  }
  for (const field of ['layout', 'widgets', 'network', 'statusbar', 'addons', 'themes', 'templates']) assert.deepEqual(restored[field], ws[field], `必须保留 ${field}`)
  assert.equal(restored.template, ws.template)
})
test('独立 App 与特效组件的源码、内容、色值和数据不会被外观重置改写', () => {
  const ws = fixture()
  const restored = resetAppearance(ws)
  const app = restored.pages[0].components.find((component) => component.type === 'app')
  const fx = restored.pages[1].components.find((component) => component.type === 'fx')
  assert.equal(app.config.css, 'body{background:navy}')
  assert.equal(app.config.html, '<p>自定义内容</p>')
  assert.equal(app.config.js, 'window.example=1')
  assert.deepEqual(app.config.data, ['保留配置'])
  assert.equal(fx.config.effect, 'aurora')
  assert.equal(fx.config.params.color, '#ff00ff')
  assert.equal(fx.config.text, '作为内容的特效')
})
test('仅恢复首页不改变全局主题、Dock、其他页面与布局', () => {
  const ws = fixture()
  const restored = resetAppearance(ws, {scope: 'home'})
  assert.deepEqual(restored.theme, ws.theme)
  assert.deepEqual(restored.dock, ws.dock)
  assert.equal(restored.pages[1], ws.pages[1])
  assert.equal(restored.pages[0].align, ws.pages[0].align)
  assert.deepEqual(restored.pages[0].layers, DEFAULT_HOME_LAYERS)
  assert.equal(restored.pages[0].wallpaper, undefined)
  assert.equal(restored.pages[0].css, undefined)
  assert.deepEqual(restored.pages[0].components, ws.pages[0].components.map(withoutLook))
  assert.deepEqual(restored.layout, ws.layout)
})
test('默认保留实际明暗，明确指定可切换，首页范围拒绝全局模式参数', () => {
  const ws = fixture()
  assert.equal(resetAppearance(ws).theme.mode, 'dark')
  const light = resetAppearance(ws, {mode: 'light'})
  assert.equal(light.theme.mode, 'light')
  assert.equal(light.theme.base, 'light')
  assert.throws(() => resetAppearance(ws, {scope: 'home', mode: 'light'}), /仅还原首页/)
})
test('无效范围或模式与缺少首页均原子失败，不改变输入', () => {
  const ws = fixture()
  const before = clone(ws)
  assert.throws(() => resetAppearance(ws, {scope: 'page'}), /scope/)
  assert.throws(() => resetAppearance(ws, {mode: 'auto'}), /mode/)
  assert.throws(() => resetAppearance({...ws, pages: ws.pages.slice(1)}, {scope: 'home'}), /没有找到首页/)
  assert.deepEqual(ws, before)
})
test('连续恢复幂等，恢复结果与查询副本不会污染默认图层或配色', () => {
  const ws = fixture()
  const first = resetAppearance(ws)
  assert.deepEqual(resetAppearance(first), first)
  assert.deepEqual(resetAppearance(resetAppearance(ws, {scope: 'home'}), {scope: 'home'}), resetAppearance(ws, {scope: 'home'}))
  const layersBefore = clone(DEFAULT_HOME_LAYERS)
  const themeBefore = clone(DEFAULT_THEME)
  const palettesBefore = clone(DEFAULT_THEME_PALETTES)
  first.pages[0].layers[0].params.opacity = 0.99
  first.themes[0].overrides.main = '#ffff00'
  assert.deepEqual(DEFAULT_HOME_LAYERS, layersBefore)
  assert.deepEqual(DEFAULT_THEME, themeBefore)
  assert.deepEqual(resetAppearance(ws).pages[0].layers, layersBefore)
  const report = defaultAppearance()
  report.home.layers[0].params.opacity = 0.88
  report.theme.light.bg = '#ffff00'
  report.theme.fonts.sans = 'Testing'
  assert.deepEqual(DEFAULT_HOME_LAYERS, layersBefore)
  assert.deepEqual(DEFAULT_THEME_PALETTES, palettesBefore)
  assert.deepEqual(defaultAppearance().theme.fonts, {...DEFAULT_STACKS, serif: fontVars(IOS_THEME.fonts)['font-serif']})
})

test('外观查询分别报告请求设计和已提交故障回落，不伪造未挂载或陈旧运行状态', () => {
  const ws = fixture(), before = clone(ws)
  assert.equal(getAppearance(ws).current.rendering, null)
  const rendering = {
    requested: {id: 'night', skin: 'paper', shell: 'standard'},
    effective: {skin: 'paper', shell: 'standard', mode: 'dark', values: {main: '#cc0000'}, sources: {main: 'default'}},
    content: 'visible', fault: {requestedShell: 'standard', reason: '测试渲染失败'},
  }
  const report = getAppearance(ws, rendering)
  assert.equal(report.current.theme.id, 'night')
  assert.equal(report.current.theme.resolved.bg, '#07111f')
  assert.deepEqual(report.current.rendering, rendering)
  for (const requested of [{...rendering.requested, id: 'old'}, {...rendering.requested, skin: 'ios'}, {...rendering.requested, shell: 'win98'}]) {
    assert.equal(getAppearance(ws, {...rendering, requested}).current.rendering, null)
  }
  assert.equal(getAppearance(ws, {...rendering, effective: {...rendering.effective, mode: 'light'}}).current.rendering, null)
  assert.deepEqual(ws, before)
})

test('外壳故障使用系统字体并保留精确请求诊断，不启动默认远端字体', () => {
  const {resolveShellTheme} = load('src/lib/shell/theme.ts')
  const {resolveTheme} = load('src/lib/themes.ts')
  const ws = fixture()
  const theme = {...ws.themes[2], packageRef: {packageId:'fixture.missing',version:'1.0.0',digest:'a'.repeat(64),themeId:'night'}, rendererContract:{schemaVersion:1,skinVersion:1,shellVersion:1}, fonts:[]}
  const requested = resolveTheme(theme, 'dark')
  const actual = resolveShellTheme(requested, {fault:{reason:'fixture'}})
  assert.equal(actual.id, theme.id)
  assert.deepEqual(actual.requested, requested.requested)
  assert.deepEqual(actual.availability, requested.availability)
  assert.equal(actual.skin, 'paper')
  assert.equal(actual.shell, 'standard')
  assert.deepEqual(actual.effectiveFonts, [])
  for (const [role, stack] of Object.entries(DEFAULT_STACKS)) assert.equal(actual.values[`font-${role}`], stack)
})

console.log(`外观恢复回归全部通过：${checks.length}/${checks.length}`)
