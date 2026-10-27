import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

// 真实领域操作、正式store和历史；只隔离浏览器存储与未运行的渲染依赖。
const root = fileURLToPath(new URL('../', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const cache = new Map(), saved = new Map()
let writes = 0
const storage = {getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => {saved.set(key, value); writes += 1}}
function load(relative) {
  const file = path.resolve(root, relative)
  if (file === path.join(root, 'src/fx/Fx.tsx')) return {FxEffect: () => null}
  if (cache.has(file)) return cache.get(file).exports
  const module = {exports: {}}
  cache.set(file, module)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText
  const require = (id) => {
    if (id === '@phosphor-icons/react') return new Proxy({}, {get: () => () => null})
    if (!id.startsWith('.')) return nodeRequire(id)
    const target = path.resolve(path.dirname(file), id)
    const resolved = ['', '.ts', '.tsx'].map((ext) => `${target}${ext}`).find(existsSync)
    assert.ok(resolved, `无法加载 ${id}`)
    return load(resolved)
  }
  new Function('module', 'exports', 'require', 'localStorage', code)(module, module.exports, require, storage)
  return module.exports
}
const registry = load('src/lib/registry.ts')
for (const type of ['clock', 'search', 'links', 'note', 'todos', 'bookmarks', 'hot', 'feeds', 'weather', 'calendar', 'agenda', 'countdown', 'quote', 'app', 'applet']) registry.registerComponent({type, name: type, defaultConfig: {}, configSchema: {}, defaultSpan: 'half', multiple: true, ...(type === 'clock' ? {status: () => null} : {})})
const ops = load('src/lib/ops.ts')
const store = load('src/lib/workspaceStore.ts')
const base = () => ({...ops.defaultWorkspace(), statusbar: [], pages: [{id: 'home', name: '首页', label: '首页', align: 'center', components: [{id: 'clock', type: 'clock', config: {}, span: 'full'}, {id: 'search', type: 'search', config: {}, span: 'full'}, {id: 'links', type: 'links', config: {links: 'GitHub https://github.com'}, span: 'full'}]}]})
let passed = 0
function test(name, run) {run(); passed += 1; console.log(`通过：${name}`)}

test('创建草稿不提交正式首页，取消不改变存储与历史', () => {
  assert.ok(existsSync(path.join(root, 'src/lib/homepageDraft.ts')), '需要独立的首页草稿生命周期入口')
  const drafts = load('src/lib/homepageDraft.ts')
  const original = base()
  store.commit(original)
  const persisted = saved.get('fp.workspace'), count = writes
  const draft = drafts.createHomepageDraft({recipeId: 'minimal'})
  assert.equal(drafts.getHomepageDraft(), draft)
  assert.equal(draft.revision, 1)
  assert.deepEqual(draft.page.components.map((item) => item.id), ['clock', 'search', 'links'])
  assert.equal(store.getWorkspace(), original)
  assert.equal(saved.get('fp.workspace'), persisted)
  assert.equal(writes, count)
  drafts.discardHomepageDraft({draftId: draft.id})
  assert.equal(drafts.getHomepageDraft(), null)
  assert.equal(store.getWorkspace(), original)
  assert.equal(writes, count)
})

test('四类组合有不同层级且仅重排原组件，默认首页与丰富内容都可用', () => {
  const recipes = load('src/lib/homepageRecipes.ts')
  const plain = base(), before = structuredClone(plain)
  const layouts = recipes.HOMEPAGE_RECIPES.map(({id}) => recipes.buildHomepageRecipe(plain, {recipeId: id}))
  assert.equal(new Set(layouts.map((page) => JSON.stringify(page.sections))).size, 4)
  assert.deepEqual(layouts[1].sections, [
    {id: 'intro', kind: 'hero', items: ['search'], align: 'start'},
    {id: 'work', kind: 'split', primary: ['links'], secondary: ['clock'], ratio: 'wide-primary'},
  ])
  assert.deepEqual(layouts[2].components.map((item) => item.id), ['clock', 'search', 'links'])
  assert.equal(layouts[2].sections[0].align, 'start')
  assert.equal(layouts[3].sections[1].columns, 2)
  for (const page of layouts) {
    assert.deepEqual(page.components.map((item) => item.id).sort(), ['clock', 'links', 'search'])
    for (const item of page.components) assert.equal(item, plain.pages[0].components.find((original) => original.id === item.id))
  }
  const rich = {...plain, pages: [{...plain.pages[0], components: [...plain.pages[0].components,
    {id: 'todo', type: 'todos', config: {heading: '工作'}, span: 'half'},
    {id: 'agenda', type: 'agenda', config: {}, span: 'half'},
    {id: 'note', type: 'note', config: {}, span: 'half'},
    {id: 'custom', type: 'custom:unknown', config: {}, span: 'third'},
    {id: 'app', type: 'applet', config: {source: 'kept'}, span: 'full'},
  ]}]}
  for (const {id} of recipes.HOMEPAGE_RECIPES) {
    const page = recipes.buildHomepageRecipe(rich, {recipeId: id, focusId: 'app'})
    assert.deepEqual(page.sections[0].items, ['app'])
    assert.equal(new Set(page.components.map((item) => item.id)).size, rich.pages[0].components.length)
    assert.deepEqual(page.components.map((item) => item.id).sort(), rich.pages[0].components.map((item) => item.id).sort())
    for (const item of page.components) assert.equal(item, rich.pages[0].components.find((original) => original.id === item.id))
  }
  assert.deepEqual(plain, before)
})

test('草稿修正与重选方案仅更新临时版本，摘要与预览有明确边界', () => {
  const drafts = load('src/lib/homepageDraft.ts')
  store.commit(base())
  const original = store.getWorkspace(), count = writes
  const first = drafts.createHomepageDraft({recipeId: 'minimal'})
  let notifications = 0
  const unsubscribe = drafts.subscribeHomepageDraft(() => {notifications += 1})
  assert.equal(typeof drafts.updateHomepageDraft, 'function', '草稿需要独立修正入口')
  const next = drafts.updateHomepageDraft({draftId: first.id, expectedRevision: 1, sections: [{id: 'focus', kind: 'hero', items: ['links']}, {id: 'rest', kind: 'section', items: ['search', 'clock'], columns: 2}]})
  assert.equal(next.id, first.id)
  assert.equal(next.revision, 2)
  assert.throws(() => drafts.updateHomepageDraft({draftId: first.id, expectedRevision: 1, sections: []}), /expectedRevision/)
  assert.throws(() => drafts.applyHomepageDraft({draftId: first.id, expectedRevision: 1}), /expectedRevision/)
  assert.deepEqual(next.page.components.map((item) => item.id), ['links', 'search', 'clock'])
  assert.deepEqual(next.basePage, first.basePage)
  assert.equal(first.revision, 1)
  const view = drafts.getHomepageDraftWorkspace()
  assert.equal(drafts.getHomepageDraftWorkspace(), view, '未变化时投影对象稳定')
  assert.equal(view.pages[0], next.page)
  assert.equal(view.applications, original.applications)
  const summary = drafts.describeHomepageDraft()
  assert.equal(summary.preview.mode, 'layout-only')
  assert.equal(summary.conflict, false)
  assert.deepEqual(summary.effectiveOrder, ['links', 'search', 'clock'])
  assert.equal(summary.components[0].config, undefined)
  summary.sections[0].items.push('fake')
  assert.deepEqual(drafts.getHomepageDraft().page.sections[0].items, ['links'], '摘要不得修改草稿')
  const switched = drafts.updateHomepageDraft({draftId: first.id, expectedRevision: 2, recipeId: 'showcase', focusId: 'search'})
  assert.equal(switched.revision, 3)
  assert.equal(switched.recipeId, 'showcase')
  assert.deepEqual(switched.page.sections[0].items, ['search'])
  assert.notEqual(drafts.getHomepageDraftWorkspace(), view)
  assert.equal(store.getWorkspace(), original)
  assert.equal(writes, count)
  assert.equal(notifications, 2)
  unsubscribe()
  drafts.discardHomepageDraft({draftId: first.id})
  assert.equal(drafts.getHomepageDraftWorkspace(), null)
  assert.equal(drafts.describeHomepageDraft(), null)
})

test('应用只提交一次并合并不相关改动，撤销重做保留原身份与业务数据', () => {
  const drafts = load('src/lib/homepageDraft.ts')
  const initial = base()
  initial.pages.push({id: 'work', name: '工作', label: '工作', components: []})
  const application = {id: 'application-1', name: '我的工具', settings: {step: 2}, settingsSchema: {}, group: '工作', openMode: 'modal', instance: {id: 'application-1', type: 'applet', config: {source: 'kept'}, span: 'half'}}
  initial.applications = [application]
  initial.pages[0].components.push(application.instance)
  store.commit(initial)
  saved.set('fp.applet.application-1', JSON.stringify({count: 7}))
  const first = drafts.createHomepageDraft({recipeId: 'productivity'})
  // Clear after rearranging must keep the draft's current reading order on apply.
  const draft = drafts.updateHomepageDraft({draftId: first.id, expectedRevision: 1, sections: []})
  const otherPage = {...initial.pages[1], name: '新工作区'}
  const latest = {...initial, theme: {...initial.theme, mode: 'dark'}, pages: [initial.pages[0], otherPage]}
  store.commit(latest)
  assert.equal(drafts.describeHomepageDraft().conflict, false)
  assert.equal(drafts.getHomepageDraftWorkspace().theme.mode, 'dark')
  const count = writes
  assert.equal(typeof drafts.applyHomepageDraft, 'function', '草稿需要单次应用入口')
  const applied = drafts.applyHomepageDraft({draftId: draft.id, expectedRevision: draft.revision})
  assert.equal(store.getWorkspace(), applied)
  assert.equal(writes, count + 1)
  assert.equal(drafts.getHomepageDraft(), null)
  assert.equal(applied.pages[1], otherPage)
  assert.equal(applied.theme, latest.theme)
  assert.equal(applied.applications, latest.applications)
  assert.deepEqual(applied.pages[0].components.map((item) => item.id), ['search', 'links', 'application-1', 'clock'])
  assert.equal(applied.pages[0].sections, undefined)
  for (const item of applied.pages[0].components) assert.equal(item, latest.pages[0].components.find((original) => original.id === item.id))
  assert.equal(saved.get('fp.applet.application-1'), '{"count":7}')
  assert.equal(store.undo(), true)
  assert.equal(store.getWorkspace(), latest, '一次撤销完整回到应用前状态')
  assert.equal(store.redo(), true)
  assert.equal(store.getWorkspace(), applied)
  assert.equal(drafts.getHomepageDraft(), null)
})

test('错误参数和旧版本原子拒绝，已有草稿不能被覆盖', () => {
  const drafts = load('src/lib/homepageDraft.ts')
  store.commit(base())
  const before = store.getWorkspace(), count = writes
  for (const input of [null, [], {}, {recipeId: 'unknown'}, {recipeId: 'minimal', focusId: 'missing'}, {recipeId: 'minimal', unexpected: true}]) {
    assert.throws(() => drafts.createHomepageDraft(input))
    assert.equal(drafts.getHomepageDraft(), null)
    assert.equal(store.getWorkspace(), before)
  }
  const draft = drafts.createHomepageDraft({recipeId: 'minimal'})
  assert.throws(() => drafts.createHomepageDraft({recipeId: 'showcase'}))
  const valid = {draftId: draft.id, expectedRevision: 1}
  for (const input of [null, [], {}, {...valid}, {...valid, sections: undefined}, {...valid, sections: {},}, {...valid, sections: [], recipeId: 'minimal'}, {...valid, focusId: 'clock'}, {...valid, sections: [], extra: true}, {...valid, sections: [], expectedRevision: 0}, {...valid, sections: [], expectedRevision: '1'}, {...valid, sections: [], draftId: 'old'}, {...valid, sections: [{id: 'x', kind: 'section', items: ['missing']}]}, {...valid, sections: [{id: 'x', kind: 'section', items: ['clock', 'clock']}]}]) {
    assert.throws(() => drafts.updateHomepageDraft(input))
    assert.equal(drafts.getHomepageDraft(), draft)
  }
  for (const input of [{draftId: draft.id}, {...valid, expectedRevision: 3}, {...valid, extra: true}]) assert.throws(() => drafts.applyHomepageDraft(input))
  for (const input of [{}, {draftId: 'old'}, {draftId: draft.id, extra: true}]) assert.throws(() => drafts.discardHomepageDraft(input))
  assert.equal(drafts.getHomepageDraft(), draft)
  assert.equal(store.getWorkspace(), before)
  assert.equal(writes, count)
  drafts.discardHomepageDraft({draftId: draft.id})
})

test('正式首页冲突拒绝覆盖，语义相同的重新序列化仍可应用', () => {
  const drafts = load('src/lib/homepageDraft.ts')
  store.commit(base())
  const initial = store.getWorkspace(), draft = drafts.createHomepageDraft({recipeId: 'showcase'})
  const changed = {...initial, pages: [{...initial.pages[0], components: initial.pages[0].components.map((item) => item.id === 'links' ? {...item, title: '后来改的标题'} : item)}]}
  store.commit(changed)
  const count = writes
  assert.equal(drafts.describeHomepageDraft().conflict, true)
  assert.throws(() => drafts.applyHomepageDraft({draftId: draft.id, expectedRevision: draft.revision}), /正式首页已变化/)
  assert.equal(store.getWorkspace(), changed)
  assert.equal(drafts.getHomepageDraft(), draft)
  assert.equal(writes, count)
  store.undo()
  assert.equal(drafts.describeHomepageDraft().conflict, false)
  const reordered = Object.fromEntries(Object.entries(initial.pages[0]).reverse())
  store.commit({...initial, pages: [reordered]})
  assert.equal(drafts.describeHomepageDraft().conflict, false, '对象字段顺序不构成设计冲突')
  drafts.applyHomepageDraft({draftId: draft.id, expectedRevision: draft.revision})
  assert.equal(drafts.getHomepageDraft(), null)
})

test('重选同一方案回到基线内容顺序，不继承前一个方案的排列', () => {
  const drafts = load('src/lib/homepageDraft.ts')
  store.commit(base())
  const first = drafts.createHomepageDraft({recipeId: 'minimal'})
  const second = drafts.updateHomepageDraft({draftId: first.id, expectedRevision: 1, recipeId: 'productivity'})
  const third = drafts.updateHomepageDraft({draftId: first.id, expectedRevision: second.revision, recipeId: 'minimal'})
  assert.deepEqual(third.page, first.page)
  drafts.discardHomepageDraft({draftId: first.id})
})

test('空首页与少量内容不补假组件，缺首页和坏焦点明确失败', () => {
  const recipes = load('src/lib/homepageRecipes.ts'), drafts = load('src/lib/homepageDraft.ts')
  const empty = {...base(), pages: [{id: 'home', name: '首页', label: '首页', components: []}]}
  for (const {id} of recipes.HOMEPAGE_RECIPES) {
    const blank = recipes.buildHomepageRecipe(empty, {recipeId: id})
    assert.deepEqual(blank.components, [])
    assert.equal(blank.sections, undefined)
    const only = {...empty, pages: [{...empty.pages[0], components: [{id: 'unknown', type: 'custom:legacy', config: {kept: true}}]}]}
    const arranged = recipes.buildHomepageRecipe(only, {recipeId: id})
    assert.equal(arranged.components.length, 1)
    assert.equal(arranged.components[0], only.pages[0].components[0])
    assert.ok(arranged.sections.every((section) => section.kind === 'split' ? section.primary.length && section.secondary.length : section.items.length))
  }
  store.commit(empty)
  const draft = drafts.createHomepageDraft({recipeId: 'minimal'})
  assert.deepEqual(drafts.describeHomepageDraft().components, [])
  drafts.applyHomepageDraft({draftId: draft.id, expectedRevision: draft.revision})
  assert.deepEqual(store.getWorkspace().pages[0].components, [])
  assert.throws(() => recipes.buildHomepageRecipe({...empty, pages: []}, {recipeId: 'minimal'}), /找不到首页/)
  assert.throws(() => recipes.buildHomepageRecipe(empty, {recipeId: 'minimal', focusId: ''}), /focusId/)
})

test('旧超额装饰和配置完整保留，清空结构可应用且不会绕过正式内容', () => {
  const drafts = load('src/lib/homepageDraft.ts'), policy = load('src/fx/policy.ts')
  const original = base()
  original.pages[0].css = 'padding:24px;'
  original.pages[0].wallpaper = {mode: 'custom', url: 'https://example.com/photo.png'}
  original.pages[0].layers = [{effect: 'aurora', params: {}}, {effect: 'silk', params: {}}]
  original.pages[0].components[0].look = {css: 'width:100%;'}
  original.pages[0].components[0].config = {format: '12h'}
  store.commit(original)
  assert.equal(policy.assessPageEffects(original.pages[0]).exceeded, true)
  const first = drafts.createHomepageDraft({recipeId: 'showcase'})
  assert.notEqual(first.basePage, original.pages[0], '基线通过设计快照独立复制')
  assert.notEqual(first.basePage.components[0].config, original.pages[0].components[0].config)
  const draft = drafts.updateHomepageDraft({draftId: first.id, expectedRevision: 1, sections: null})
  const applied = drafts.applyHomepageDraft({draftId: draft.id, expectedRevision: 2})
  assert.equal(applied.pages[0].sections, undefined)
  assert.equal(applied.pages[0].layers, original.pages[0].layers)
  assert.equal(applied.pages[0].wallpaper, original.pages[0].wallpaper)
  assert.equal(applied.pages[0].css, original.pages[0].css)
  assert.equal(applied.pages[0].components.find((item) => item.id === 'clock'), original.pages[0].components[0])
  assert.deepEqual(policy.assessPageEffects(applied.pages[0]), policy.assessPageEffects(original.pages[0]))
})

console.log(`首页草稿回归全部通过：${passed}/${passed}`)
