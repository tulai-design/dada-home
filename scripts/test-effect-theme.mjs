import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

// 真实目录、工作空间操作与模板；只隔离渲染模块和本地存储，不读用户数据。
const root = fileURLToPath(new URL('../', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const cache = new Map()
const saved = new Map()
const storage = {getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)}
function load(relative) {
  const file = path.resolve(root, relative)
  if (file === path.join(root, 'src/fx/Fx.tsx')) return {FxEffect: () => null}
  if (cache.has(file)) return cache.get(file).exports
  const module = {exports: {}}
  cache.set(file, module)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
  }).outputText
  const require = (id) => {
    if (id === '@phosphor-icons/react') return new Proxy({}, {get: () => () => null})
    if (!id.startsWith('.')) return nodeRequire(id)
    const target = path.resolve(path.dirname(file), id)
    const resolved = ['', '.ts', '.tsx'].map((ext) => `${target}${ext}`).find((candidate) => existsSync(candidate))
    assert.ok(resolved, `无法加载 ${id}（来自 ${file}）`)
    return load(resolved)
  }
  new Function('module', 'exports', 'require', 'localStorage', code)(module, module.exports, require, storage)
  return module.exports
}
const registry = load('src/lib/registry.ts')
for (const type of ['clock', 'search', 'links', 'note', 'todos', 'bookmarks', 'hot', 'feeds']) {
  registry.registerComponent({type, name: type, defaultConfig: {}, configSchema: {}, defaultSpan: 'half', multiple: true, ...(type === 'clock' ? {status: () => null} : {})})
}
load('src/widgets/fx.tsx')
const ops = load('src/lib/ops.ts')
const catalog = load('src/fx/catalog.ts')
const templates = load('src/lib/templates.ts')
const base = () => ({...ops.defaultWorkspace(), statusbar: [], pages: [{id: 'home', name: '首页', label: '首页', icon: 'home', components: []}]})
const add = (effect, params) => ops.addComponent(base(), {pageId: 'home', type: 'fx', config: {effect, text: '我的标题', params}})
let passed = 0
function test(name, run) {run();passed++;console.log(`通过：${name}`)}

test('新增文字特效与背景图层保存语义色板及两套显式颜色', () => {
  const params = {palette: 'theme', color: '#123456', light: {color: '#111111'}, dark: {color: '#eeeeee'}}
  const result = add('split-text', params)
  assert.equal(result.instance.config.params.palette, 'theme')
  assert.deepEqual(result.instance.config.params.light, {color: '#111111'})
  assert.deepEqual(result.instance.config.params.dark, {color: '#eeeeee'})
  const page = ops.setLayers(base(), 'home', [{effect: 'waves', params: {palette: 'theme', light: {lineColor: '#222222'}, dark: {lineColor: '#dddddd'}}}]).pages[0]
  assert.equal(page.layers[0].params.palette, 'theme')
  assert.deepEqual(page.layers[0].params.dark, {lineColor: '#dddddd'})
})

test('公开目录说明可用颜色字段、覆盖顺序及场景边界', () => {
  const info = catalog.describeFx(catalog.getFx('waves'))
  assert.deepEqual(info.theme.colorFields, ['lineColor', 'accentColor', 'backgroundColor', 'textColor'])
  assert.deepEqual(info.theme.precedence, ['params', 'palette', 'currentMode'])
  assert.ok(info.params.palette)
  assert.ok(info.params.light && info.params.dark)
  assert.deepEqual(catalog.describeFx(catalog.getFx('noise')).theme.colorFields, [])
  assert.deepEqual(catalog.describeFx(catalog.getFx('spline')).theme.colorFields, ['textColor'])
})

const {resolveFxTheme, hasFxTheme} = load('src/fx/theme.ts')
const lightColors = {text: '#181818', text2: '#444444', text3: '#666666', bg: '#fafafa', bg2: '#eeeeee', bg3: '#dddddd', border: '#cccccc', main: '#bb2222', 'c-amber': '#995500', 'c-blue': '#225599', 'c-violet': '#664499'}
const darkColors = {text: '#eeeeee', text2: '#cccccc', text3: '#aaaaaa', bg: '#111111', bg2: '#222222', bg3: '#333333', border: '#555555', main: '#ff6666', 'c-amber': '#eebb66', 'c-blue': '#66bbff', 'c-violet': '#bb88ff'}
const resolve = (id, params, dark = false, colors = dark ? darkColors : lightColors) => resolveFxTheme(catalog.getFx(id), params, {dark, colors})

test('同一已保存文字按当前模式解析，分支优先于语义色板且不修改配置', () => {
  const params = add('split-text', {palette: 'theme', color: '#123456', light: {color: '#080808'}, dark: {accentColor: '#aabbcc'}}).instance.config.params
  const before = structuredClone(params)
  assert.equal(resolve('split-text', params).color, '#080808')
  assert.equal(resolve('split-text', params).accentColor, '#bb2222')
  assert.equal(resolve('split-text', params, true).color, '#eeeeee')
  assert.equal(resolve('split-text', params, true).accentColor, '#aabbcc')
  assert.equal(resolve('split-text', params, true, {...darkColors, text: '#ddddaa'}).color, '#ddddaa', '同模式新主题值必须参与解析')
  assert.deepEqual(params, before)
  assert.equal(hasFxTheme(params), true)
  for (const key of ['palette', 'light', 'dark']) assert.equal(key in resolve('split-text', params), false)
})

test('卡片与背景使用宿主语义，文本与透明背景保留各自职责', () => {
  const glare = add('glare-hover', {palette: 'theme'}).instance.config.params
  assert.equal(resolve('glare-hover', glare).background, '#eeeeee')
  assert.equal(resolve('glare-hover', glare).color, '#181818')
  assert.equal(resolve('glare-hover', glare, true).background, '#222222')
  assert.equal(resolve('glare-hover', glare, true).color, '#eeeeee')
  const waves = catalog.normalizeLayer({effect: 'waves', params: {palette: 'theme', dark: {lineColor: '#abcdef'}}}).params
  assert.equal(resolve('waves', waves).lineColor, '#666666')
  assert.equal(resolve('waves', waves).textColor, '#181818')
  assert.equal(resolve('waves', waves, true).lineColor, '#abcdef')
  const orb = catalog.normalizeLayer({effect: 'orb', params: {palette: 'theme'}}).params
  assert.equal(resolve('orb', orb).backgroundColor, 'rgba(0,0,0,0)', '光球原透明背景不应被色板填实')
  assert.deepEqual(resolve('orb', orb, true).colors, ['#ff6666', '#eebb66', '#bb88ff'])
})

test('分支只保存本效果合法颜色，不能覆盖预算参数、场景或嵌套控制字段', () => {
  const params = add('gradient-text', {
    palette: 'invalid',
    light: {color: 'var(--text)', colors: ['#112233', 'url(x)', '#445566', '#778899', '#aabbcc', '#ddeeff', '#123456', '#654321'], size: 240, animationSpeed: 2, palette: 'theme', dark: {color: '#fff'}},
    dark: {color: 'transparent', bogus: '#fff', colors: ['rgba(1,2,3,0.5)', 'hsl(20,30%,40%)']},
  }).instance.config.params
  assert.equal(params.palette, undefined)
  assert.deepEqual(params.light, {colors: ['#112233', '#445566', '#778899', '#aabbcc', '#ddeeff', '#123456']})
  assert.deepEqual(params.dark, {color: 'transparent', colors: ['rgba(1,2,3,0.5)', 'hsl(20,30%,40%)']})
  const scene = catalog.normalizeLayer({effect: 'spline', params: {scene: 'https://prod.spline.design/example/scene.splinecode', light: {scene: 'https://evil.example/scene.splinecode', textSize: 160, textColor: '#121212'}}})
  assert.deepEqual(scene.params.light, {textColor: '#121212'})
  assert.equal(scene.params.scene, 'https://prod.spline.design/example/scene.splinecode')
})

test('非法与空配色控制回退为旧合同，单分支不向另一模式泄漏颜色', () => {
  for (const malformed of [null, [], false, 'dark', {}, {color: 'url(x)'}, {size: 50}]) {
    const params = add('split-text', {color: '#123456', palette: false, light: malformed, dark: malformed}).instance.config.params
    assert.equal(hasFxTheme(params), false)
    assert.equal(resolve('split-text', params).color, '#123456')
  }
  const params = add('split-text', {color: '#123456', light: {color: '#111111'}}).instance.config.params
  assert.equal(resolve('split-text', params).color, '#111111')
  assert.equal(resolve('split-text', params, true).color, '#123456')
})

test('旧固定色与数组保持原值；渲染副本修改不污染保存数据或目录默认值', () => {
  for (const id of ['split-text', 'glare-hover', 'waves', 'gradient-text']) {
    const def = catalog.getFx(id)
    const params = catalog.normalizeParams(def, {color: 'hsl(20,30%,40%)'})
    const before = structuredClone(params)
    const defaults = structuredClone(def.defaults)
    assert.deepEqual(resolve(id, params), params)
    assert.deepEqual(resolve(id, params, true), params)
    const runtime = resolve(id, params)
    if (Array.isArray(runtime.colors)) runtime.colors.push('#123456')
    assert.deepEqual(params, before)
    assert.deepEqual(def.defaults, defaults)
  }
  const params = add('gradient-text', {dark: {colors: ['#123456', '#abcdef']}}).instance.config.params
  const runtime = resolve('gradient-text', params, true)
  runtime.colors.push('#000000')
  assert.deepEqual(params.dark.colors, ['#123456', '#abcdef'])
})

test('新增配色经模板、迁移和撤销往返保留，清除配色只影响当前实例', () => {
  const result = add('split-text', {palette: 'theme', light: {color: '#111111'}, dark: {color: '#eeeeee'}})
  const workspace = ops.setLayers(result.workspace, 'home', [{effect: 'waves', params: {palette: 'theme', dark: {lineColor: '#aaaaaa'}}}])
  const before = structuredClone(workspace)
  const template = templates.saveTemplate(workspace, {name: '双主题设计'})
  const applied = templates.applyTemplate(template.workspace, template.template.id).workspace
  assert.deepEqual(applied.pages, before.pages)
  saved.set('fp.workspace', JSON.stringify(workspace))
  const store = load('src/lib/workspaceStore.ts')
  assert.deepEqual(store.migrate(workspace).pages, before.pages)
  assert.deepEqual(store.getWorkspace().pages, before.pages)
  const updated = ops.updateComponent(store.getWorkspace(), result.instance.id, {config: {params: {size: 64}}}).workspace
  assert.equal(hasFxTheme(updated.pages[0].components[0].config.params), true, '普通参数更新不得删除已有配色')
  const changed = ops.updateComponent(updated, result.instance.id, {config: {params: {color: '#335577', palette: null, light: null, dark: null}}}).workspace
  assert.equal(hasFxTheme(changed.pages[0].components[0].config.params), false)
  assert.deepEqual(changed.pages[0].layers, before.pages[0].layers)
  store.commit(changed)
  store.undo()
  assert.deepEqual(store.getWorkspace().pages, before.pages)
  store.redo()
  assert.deepEqual(store.getWorkspace().pages, changed.pages)
  assert.deepEqual(workspace, before)
})

console.log(`特效主题回归全部通过：${passed}/${passed}`)
