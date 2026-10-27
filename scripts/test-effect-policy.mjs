import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

// 执行真实目录、注册、操作、模板与迁移；隔离浏览器渲染和本地存储，不读用户数据。
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
const templates = load('src/lib/templates.ts')
const {resetAppearance} = load('src/lib/appearance.ts')
const catalog = load('src/fx/catalog.ts')
const {assessPageEffects, planPageEffects} = load('src/fx/policy.ts')
const clone = (value) => JSON.parse(JSON.stringify(value))
const base = () => ({...ops.defaultWorkspace(), statusbar: [], pages: [{id: 'home', name: '首页', label: '首页', icon: 'home', components: []}]})
const add = (workspace, effect, pageId = 'home') => ops.addComponent(workspace, {pageId, type: 'fx', config: {effect, text: '保留我的内容'}})
const block = (id, effect, params = {}) => ({id, type: 'fx', span: 'full', config: registry.normalizeConfig(registry.getDefinition('fx'), {effect, text: '保留我的内容', params})})
function rejectsBudget(workspace, run) {
  const before = clone(workspace)
  assert.throws(run, (error) => error instanceof ops.WorkspaceError && /特效超出预算/.test(error.message))
  assert.deepEqual(workspace, before)
}
let passed = 0
function test(name, run) {run();passed += 1;console.log(`通过：${name}`)}

test('页面图层和效果块共用 GPU 上限，拒绝新增且保持原设计', () => {
  const workspace = ops.setLayers(base(), 'home', [{effect: 'aurora'}])
  rejectsBudget(workspace, () => add(workspace, 'silk'))
})

test('旧超限配置可存模板，但重新套用时严格拒绝且不覆盖当前设计', () => {
  const legacy = base()
  legacy.pages[0].layers = ['aurora', 'silk'].map((effect) => catalog.normalizeLayer({effect}))
  const saved = templates.saveTemplate(legacy, {name: '旧特效设计'})
  rejectsBudget(saved.workspace, () => templates.applyTemplate(saved.workspace, saved.template.id))
  assert.deepEqual(saved.template.snapshot.pages, legacy.pages)
})

test('setLayers 与更新效果同样计入现有内容块，不留下半份修改', () => {
  const withBlock = add(base(), 'silk').workspace
  rejectsBudget(withBlock, () => ops.setLayers(withBlock, 'home', [{effect: 'aurora'}]))
  const withLayer = ops.setLayers(base(), 'home', [{effect: 'aurora'}])
  const text = add(withLayer, 'split-text')
  rejectsBudget(text.workspace, () => ops.updateComponent(text.workspace, text.instance.id, {config: {effect: 'silk'}}))
})

test('跨页移动检查目标页，拒绝时源页面仍保留同一实例', () => {
  let workspace = ops.setLayers(base(), 'home', [{effect: 'aurora'}])
  workspace = ops.addPage(workspace, {id: 'second', name: '第二页'}).workspace
  const source = add(workspace, 'silk', 'second')
  rejectsBudget(source.workspace, () => ops.moveComponent(source.workspace, source.instance.id, {toPageId: 'home'}))
  assert.equal(source.workspace.pages[1].components[0].id, source.instance.id)
})

test('八个一次入场文字可保存，第九个超过总点数而非持续动画上限', () => {
  let workspace = base()
  for (let index = 0; index < 8; index += 1) workspace = add(workspace, 'split-text').workspace
  assert.equal(assessPageEffects(workspace.pages[0]).continuousCount, 0)
  rejectsBudget(workspace, () => add(workspace, 'split-text'))
})

test('更新循环参数会重新计量，同页第四个循环文字被拒绝', () => {
  let workspace = base()
  for (let index = 0; index < 4; index += 1) workspace = add(workspace, 'split-text').workspace
  const ids = workspace.pages[0].components.map((component) => component.id)
  for (const id of ids.slice(0, 3)) workspace = ops.updateComponent(workspace, id, {config: {params: {loop: true}}}).workspace
  rejectsBudget(workspace, () => ops.updateComponent(workspace, ids[3], {config: {params: {loop: true}}}))
})

test('旧超限页面允许普通编辑和逐步减负，但不允许继续增加超标维度', () => {
  const legacy = base()
  legacy.pages[0].components = Array.from({length: 5}, (_, index) => block(`legacy-${index}`, 'split-text', {loop: index < 4}))
  assert.equal(assessPageEffects(legacy.pages[0]).exceeded, true)
  const restyled = ops.setPageStyle(legacy, 'home', {align: 'start'})
  const edited = ops.updateComponent(restyled, 'legacy-0', {title: '保留标题', config: {text: '更新正文'}}).workspace
  assert.equal(edited.pages[0].components[0].config.text, '更新正文')
  const lighter = ops.removeComponent(edited, 'legacy-0').workspace
  assert.equal(lighter.pages[0].components.length, 4)
  assert.equal(assessPageEffects(lighter.pages[0]).exceeded, false)
  rejectsBudget(legacy, () => ops.updateComponent(legacy, 'legacy-4', {config: {params: {loop: true}}}))
})

test('同页排序保持旧超限页面可编辑，运行计划按新顺序确定优先级', () => {
  const legacy = base()
  legacy.pages[0].components = [block('first', 'aurora'), block('second', 'silk')]
  const moved = ops.moveComponent(legacy, 'second', {toIndex: 0})
  const plan = planPageEffects(moved.pages[0], {compact: false})
  assert.deepEqual(plan.entries.map(({key, mode}) => ({key, mode})), [
    {key: 'block:second', mode: 'animated'}, {key: 'block:first', mode: 'static'},
  ])
})

test('内置模板仍可应用，合法的自存模板完整保留效果参数和正文', () => {
  for (const id of ['preset-minimal', 'preset-desk', 'preset-reader', 'preset-night']) {
    const applied = templates.applyTemplate(base(), id).workspace
    assert.ok(applied.pages.every((page) => !assessPageEffects(page).exceeded), `${id} 应保持可用`)
  }
  const designed = add(ops.setLayers(base(), 'home', [{effect: 'aurora', params: {speed: 0.5}}]), 'split-text').workspace
  const saved = templates.saveTemplate(designed, {name: '有效设计'})
  assert.deepEqual(templates.applyTemplate(saved.workspace, saved.template.id).workspace.pages, designed.pages)
})

test('加载与模板读取保留旧超限配置，减负后仍可撤销和重做', () => {
  const legacy = base()
  legacy.pages[0].layers = ['aurora', 'silk'].map((effect) => catalog.normalizeLayer({effect}))
  legacy.pages[0].components = [block('legacy-body', 'split-text', {loop: true})]
  const savedLegacy = templates.saveTemplate(legacy, {name: '可恢复旧配置'}).workspace
  const before = clone(savedLegacy)
  saved.set('fp.workspace', JSON.stringify(savedLegacy))
  const store = load('src/lib/workspaceStore.ts')
  const migrated = store.migrate(savedLegacy)
  assert.deepEqual(migrated.pages, before.pages)
  assert.deepEqual(migrated.templates[0].snapshot.pages, before.pages)
  assert.deepEqual(savedLegacy, before)
  assert.deepEqual(store.getWorkspace().pages, before.pages)
  const lighter = ops.setLayers(store.getWorkspace(), 'home', [{effect: 'aurora'}])
  store.commit(lighter)
  assert.equal(store.getWorkspace().pages[0].layers.length, 1)
  store.undo()
  assert.deepEqual(store.getWorkspace().pages, before.pages)
  store.redo()
  assert.deepEqual(store.getWorkspace().pages, lighter.pages)
})

test('旧设计共享图层和内容块运行预算，静态降级保留配置及可解释原因', () => {
  const legacy = base()
  legacy.pages[0].layers = [catalog.normalizeLayer({effect: 'aurora'})]
  legacy.pages[0].components = [block('banner', 'silk'), block('heading', 'split-text')]
  const before = clone(legacy)
  const plan = planPageEffects(legacy.pages[0], {compact: false})
  assert.deepEqual(plan.entries.map(({key, mode}) => ({key, mode})), [
    {key: 'layer:0', mode: 'animated'}, {key: 'block:banner', mode: 'static'}, {key: 'block:heading', mode: 'animated'},
  ])
  assert.ok(plan.entries.find((entry) => entry.key === 'block:banner').reason)
  assert.ok(plan.notice.length > 0)
  assert.deepEqual(legacy, before)
})

test('窄容器静态展示 GPU 与外部场景，四点之外的文字保持为静态内容', () => {
  const page = base().pages[0]
  page.layers = [catalog.normalizeLayer({effect: 'aurora'}), catalog.normalizeLayer({effect: 'spline', params: {scene: 'https://prod.spline.design/test/scene.splinecode'}})]
  page.components = Array.from({length: 5}, (_, index) => block(`text-${index}`, 'split-text'))
  const before = clone(page)
  const plan = planPageEffects(page, {compact: true})
  assert.deepEqual(plan.entries.map((entry) => entry.mode), ['static', 'static', 'animated', 'animated', 'animated', 'animated', 'static'])
  assert.deepEqual(page, before)
})

test('公开目录披露每项实际渲染类型、容器、移动策略、质量限制及来源状态', () => {
  const listed = catalog.FX_DEFS.map(catalog.describeFx)
  for (const effect of listed) {
    assert.ok(effect.policy, `${effect.id} 缺少可查询策略`)
    assert.ok(effect.policy.containers.length > 0)
    assert.ok(effect.policy.touch)
    assert.equal(effect.policy.reducedMotion, 'static')
    assert.ok(effect.policy.quality && effect.policy.source.location)
    assert.equal(effect.policy.source.license, 'needs-verification')
  }
  const byId = (id) => listed.find((effect) => effect.id === id).policy
  assert.equal(byId('waves').renderer, 'webgl', '波纹线真实实现也占用 GPU，不能当成廉价 DOM 背景')
  assert.equal(byId('waves').cost, 3)
  assert.equal(byId('noise').renderer, 'canvas')
  assert.equal(byId('noise').cost, 2)
  assert.equal(byId('split-text').cost, 1)
  assert.equal(byId('spline').cost, 6)
  assert.equal(byId('spline').compact, 'static')
})

test('默认首页满足预算，未知旧效果保留正文并明确计划为静态', () => {
  assert.equal(assessPageEffects(ops.defaultWorkspace().pages[0]).exceeded, false)
  const page = base().pages[0]
  page.components = [{id: 'unknown', type: 'fx', config: {effect: 'retired-effect', text: '历史正文'}}]
  const before = clone(page)
  const plan = planPageEffects(page, {compact: false})
  assert.equal(plan.entries[0].mode, 'static')
  assert.ok(plan.entries[0].reason)
  assert.deepEqual(page, before)
})

test('还原默认外观不能在保留的 GPU 内容块之上再增加 GPU 背景，拒绝不部分还原', () => {
  const workspace = add(base(), 'silk').workspace
  workspace.pages[0].css = 'background:purple;'
  workspace.pages[0].components[0].look = {tone: 'main'}
  workspace.dock = {preset: 'solid', css: '&{background:purple}'}
  workspace.theme = {...workspace.theme, active: 'custom', mode: 'dark'}
  workspace.themes.push({id: 'custom', name: '我的配色', description: '', overrides: {main: '#663399'}})
  rejectsBudget(workspace, () => resetAppearance(workspace, {scope: 'home'}))
  rejectsBudget(workspace, () => resetAppearance(workspace, {scope: 'all', mode: 'light'}))
  const withTools = ops.addPage(workspace, {id: 'tools', name: '工具'}).workspace
  const moved = ops.moveComponent(withTools, workspace.pages[0].components[0].id, {toPageId: 'tools'})
  const restored = resetAppearance(moved)
  assert.equal(restored.pages[0].layers[0].effect, 'waves')
  assert.deepEqual(restored.pages[1].components[0].config, workspace.pages[0].components[0].config)
})

test('旧超限页可还原不增加负荷的默认背景，内容和原始配置保持', () => {
  const legacy = add(base(), 'silk').workspace
  legacy.pages[0].layers = [catalog.normalizeLayer({effect: 'aurora'})]
  legacy.pages[0].css = 'background:purple;'
  const before = clone(legacy)
  assert.equal(assessPageEffects(legacy.pages[0]).gpuCount, 2)
  for (const scope of ['home', 'all']) {
    const restored = resetAppearance(legacy, {scope})
    assert.equal(restored.pages[0].layers[0].effect, 'waves')
    assert.equal(restored.pages[0].css, undefined)
    assert.equal(assessPageEffects(restored.pages[0]).gpuCount, 2)
    assert.deepEqual(restored.pages[0].components, legacy.pages[0].components)
  }
  assert.deepEqual(legacy, before)
})

test('旧扫光卡片非法模式按默认循环计量，不能绕过第四项持续动画降级', () => {
  for (const mode of [null, 'invalid', false, []]) {
    const page = base().pages[0]
    page.components = ['shiny-text', 'gradient-text', 'text-type'].map((effect, index) => block(`loop-${index}`, effect))
    page.components.push({id: 'legacy-glare', type: 'fx', config: {effect: 'glare-hover', text: '卡片正文', params: {mode}}})
    const before = clone(page)
    assert.equal(assessPageEffects(page).continuousCount, 4, `旧模式 ${JSON.stringify(mode)} 应回退为循环`)
    const plan = planPageEffects(page, {compact: false})
    assert.equal(plan.entries.find((entry) => entry.key === 'block:legacy-glare').mode, 'static')
    assert.deepEqual(page, before)
  }
})

test('原始旧参数与目录规整后的持续动画预算和运行计划一致', () => {
  const cases = [
    ['noise', {fps: -1}, 0], ['noise', {fps: -Infinity}, 1], ['noise', {fps: '0'}, 1], ['noise', {fps: null}, 1],
    ['fuzzy-text', {baseIntensity: -1}, 0],
    ['fuzzy-text', {baseIntensity: 0, glitchMode: 'false'}, 0],
    ['fuzzy-text', {baseIntensity: 0, glitchMode: {}, trigger: 'invalid'}, 0],
    ['fuzzy-text', {baseIntensity: 0, glitchMode: true}, 1],
    ['fuzzy-text', {baseIntensity: 0, trigger: 'always'}, 1],
    ['fuzzy-text', {baseIntensity: '0'}, 1],
    ...['split-text', 'blur-text', 'decrypted-text'].flatMap((effect) => [
      [effect, {loop: 'true', trigger: 'invalid', animateOn: 'invalid'}, 0],
      [effect, {loop: [], trigger: null, animateOn: false}, 0],
      [effect, {loop: true}, 1],
    ]),
    ...[null, 'invalid', false, ['hover']].map((trigger) => ['shiny-text', {trigger}, 1]),
    ['shiny-text', {trigger: 'view'}, 0], ['shiny-text', {trigger: 'hover'}, 0],
    ...[null, 'false', 0, []].map((loop) => ['text-type', {loop}, 1]),
    ['text-type', {loop: false}, 0],
    ...['true', 1, null, []].map((ambient) => ['spotlight-card', {ambient}, 0]),
    ['spotlight-card', {ambient: true}, 1],
    ...[null, 'invalid', false, []].map((mode) => ['glare-hover', {mode}, 1]),
    ...['hover', 'follow', 'click'].map((mode) => ['glare-hover', {mode}, 0]),
  ]
  for (const [effect, params, continuous] of cases) {
    const page = base().pages[0]
    page.components = ['shiny-text', 'gradient-text', 'text-type'].map((id, index) => block(`loop-${index}`, id))
    const def = catalog.getFx(effect)
    if (def.kind === 'overlay') page.layers = [{effect, params}]
    else page.components.push({id: 'old-effect', type: 'fx', config: {effect, params, text: '原有内容'}})
    const normalized = structuredClone(page)
    if (def.kind === 'overlay') normalized.layers[0].params = catalog.normalizeParams(def, params)
    else normalized.components[3].config.params = catalog.normalizeParams(def, params)
    const before = structuredClone(page)
    const context = `${effect} ${JSON.stringify(params)}`
    assert.equal(assessPageEffects(normalized).continuousCount, 3 + continuous, context)
    assert.deepEqual(assessPageEffects(page), assessPageEffects(normalized), context)
    for (const compact of [false, true]) {
      assert.deepEqual(planPageEffects(page, {compact}), planPageEffects(normalized, {compact}), context)
    }
    assert.deepEqual(page, before, context)
  }
})

console.log(`特效策略回归全部通过：${passed}/${passed}`)
