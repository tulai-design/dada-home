import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

// 真实公开操作/模板/迁移/历史；仅隔离渲染、图标和用户存储。
const root = fileURLToPath(new URL('../', import.meta.url))
const nodeRequire = createRequire(import.meta.url)
const cache = new Map(), saved = new Map()
const storage = {getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)}
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
    const resolved = ['', '.ts', '.tsx'].map((ext) => `${target}${ext}`).find((candidate) => existsSync(candidate))
    assert.ok(resolved, `无法加载 ${id}`)
    return load(resolved)
  }
  new Function('module', 'exports', 'require', 'localStorage', code)(module, module.exports, require, storage)
  return module.exports
}
const registry = load('src/lib/registry.ts')
for (const type of ['clock', 'search', 'links', 'note', 'todos', 'bookmarks', 'hot', 'feeds']) registry.registerComponent({type, name: type, defaultConfig: {}, configSchema: {}, defaultSpan: 'half', multiple: true, ...(type === 'clock' ? {status: () => null} : {})})
registry.registerComponent({type: 'applet', name: '小程序', defaultConfig: {source: ''}, configSchema: {source: {kind: 'string'}}, defaultSpan: 'half', multiple: true})
const ops = load('src/lib/ops.ts')
const templates = load('src/lib/templates.ts')
const apps = load('src/lib/applications.ts')
const clone = (value) => JSON.parse(JSON.stringify(value))
const item = (id) => ({id, type: 'note', config: {}, span: 'half'})
const base = () => ({...ops.defaultWorkspace(), statusbar: [], addons: ['desk'], pages: [{id: 'home', name: '首页', label: '首页', components: ['a', 'b', 'c', 'd'].map(item)}]})
const sections = () => [{id: 'hero', kind: 'hero', items: ['b']}, {id: 'work', kind: 'split', primary: ['c'], secondary: ['a']}]
const ids = (page) => page.components.map((value) => value.id)
let passed = 0
function test(name, run) {run(); passed += 1; console.log(`通过：${name}`)}

test('分区引用原组件并统一阅读顺序，未分组内容保留', () => {
  const ws = base(), before = clone(ws)
  assert.equal(typeof ops.setPageSections, 'function', '需要公开布局写入操作')
  const next = ops.setPageSections(ws, 'home', sections())
  assert.deepEqual(ids(next.pages[0]), ['b', 'c', 'a', 'd'])
  for (const component of next.pages[0].components) assert.equal(component, ws.pages[0].components.find((old) => old.id === component.id))
  assert.deepEqual(ws, before)
  assert.equal(ops.setPageSections(next, 'home', null).pages[0].sections, undefined)
  assert.deepEqual(ids(ops.setPageSections(next, 'home', []).pages[0]), ['b', 'c', 'a', 'd'])
})

test('非法分区原子拒绝，空分区和默认参数合法', () => {
  const ws = base(), before = clone(ws)
  const bad = [undefined, {}, [{id: '中文', kind: 'section', items: []}], [{id: 'x', kind: 'section', items: ['lost']}],
    [{id: 'x', kind: 'section', items: ['a', 'a']}], [{id: 'x', kind: 'section', items: [], columns: 4}],
    [{id: 'x', kind: 'hero', items: [], align: 'end'}], [{id: 'x', kind: 'split', primary: [], secondary: [], ratio: 'odd'}],
    [{id: 'x', kind: 'section', items: [], title: 'x'.repeat(81)}], [{id: 'x', kind: 'section', items: [], surprise: true}],
    [{id: 'x', kind: 'section', items: []}, {id: 'x', kind: 'section', items: []}],
    [{id: 'x', kind: 'hero', items: []}, {id: 'y', kind: 'hero', items: []}],
    Array.from({length: 9}, (_, i) => ({id: `s${i}`, kind: 'section', items: []}))]
  for (const raw of bad) assert.throws(() => ops.setPageSections(ws, 'home', raw))
  assert.deepEqual(ws, before)
  const page = ops.setPageSections(ws, 'home', [{id: 'x', kind: 'section', items: []}]).pages[0]
  assert.equal(page.sections[0].columns, 2)
  assert.deepEqual(ids(page), ['a', 'b', 'c', 'd'])
})

test('同页移动和新增按目标槽位插入，末尾保持未分组', () => {
  const ws = ops.setPageSections(base(), 'home', sections())
  const moved = ops.moveComponent(ws, 'd', {toIndex: 1})
  assert.deepEqual(ids(moved.pages[0]), ['b', 'd', 'c', 'a'])
  assert.deepEqual(moved.pages[0].sections[1].primary, ['d', 'c'])
  const toSecondary = ops.moveComponent(moved, 'c', {toIndex: 2})
  assert.deepEqual(toSecondary.pages[0].sections[1].primary, ['d'])
  assert.deepEqual(toSecondary.pages[0].sections[1].secondary, ['c', 'a'])
  const end = ops.moveComponent(toSecondary, 'b', {})
  assert.deepEqual(ids(end.pages[0]), ['d', 'c', 'a', 'b'])
  assert.deepEqual(end.pages[0].sections[0].items, [])
  const added = ops.addComponent(ws, {pageId: 'home', type: 'note', index: 1})
  assert.deepEqual(added.workspace.pages[0].sections[1].primary, [added.instance.id, 'c'])
  const appended = ops.addComponent(ws, {pageId: 'home', type: 'note'})
  assert.equal(ids(appended.workspace.pages[0]).at(-1), appended.instance.id)
  assert.deepEqual(appended.workspace.pages[0].sections, ws.pages[0].sections)
  assert.deepEqual(ws.pages[0].sections[1].primary, ['c'])
})

test('跨页移动与删除同时清理源引用，目标位置沿用槽位规则', () => {
  let ws = ops.setPageSections(base(), 'home', sections())
  ws = {...ws, pages: [...ws.pages, {id: 'work', name: '工作', label: '工作', components: [item('e'), item('f')]}]}
  ws = ops.setPageSections(ws, 'work', [{id: 'main', kind: 'section', items: ['e', 'f']}])
  const moved = ops.moveComponent(ws, 'c', {toPageId: 'work', toIndex: 1})
  assert.deepEqual(moved.pages[0].sections[1].primary, [])
  assert.deepEqual(moved.pages[1].sections[0].items, ['e', 'c', 'f'])
  assert.deepEqual(ids(moved.pages[1]), ['e', 'c', 'f'])
  const removed = ops.removeComponent(moved, 'a').workspace
  assert.deepEqual(removed.pages[0].sections[1].secondary, [])
})

test('卸载市场组件与自定义组件清理引用，保留其他实体', () => {
  let ws = base()
  ws.pages[0].components[3] = {...item('d'), type: 'clock'}
  ws = ops.setPageSections(ws, 'home', sections())
  const removedAddon = ops.uninstallAddon(ws, 'desk').workspace
  assert.deepEqual(ids(removedAddon.pages[0]), ['d'])
  assert.deepEqual(removedAddon.pages[0].sections.map((section) => section.items ?? [...section.primary, ...section.secondary]), [[], []])
  const custom = {...base(), widgets: [{id: 'mine', name: '自定义'}]}
  custom.pages[0].components[0] = {...item('a'), type: 'custom:mine'}
  const removedCustom = ops.removeWidget(ops.setPageSections(custom, 'home', sections()), 'mine')
  assert.deepEqual(removedCustom.instances, ['a'])
  assert.deepEqual(removedCustom.workspace.pages[0].sections[1].secondary, [])
  assert.deepEqual(ids(removedCustom.workspace.pages[0]), ['b', 'c', 'd'])
})

test('同页应用挂载只调宽度，跨页、取消挂载及卸载清理旧引用', () => {
  const created = apps.createApplication(base(), {type: 'applet', title: '计数', config: {source: 'export default function App(){return null}'}})
  const id = created.application.id
  let ws = apps.mountApplication(created.workspace, id, 'home', 'third')
  ws = ops.updateComponent(ws, id, {look: {variant: 'quiet'}}).workspace
  ws = ops.setPageSections(ws, 'home', [{id: 'tools', kind: 'split', primary: ['b', id, 'a'], secondary: ['c']}])
  const before = clone(ws)
  const same = apps.mountApplication(ws, id, 'home', 'full')
  assert.deepEqual(ids(same.pages[0]), ['b', id, 'a', 'c', 'd'])
  assert.deepEqual(same.pages[0].sections, ws.pages[0].sections)
  assert.equal(same.pages[0].components[1].span, 'full')
  assert.equal(same.pages[0].components[1].look.variant, 'quiet')
  const unchanged = apps.mountApplication(ws, id, 'home')
  assert.equal(unchanged.pages[0].components[1].span, 'third')
  assert.deepEqual(ws, before)
  const detached = apps.mountApplication(ws, id, null)
  assert.deepEqual(detached.pages[0].sections[0].primary, ['b', 'a'])
  assert.equal(detached.applications[0].id, id)
  const cross = apps.mountApplication({...ws, pages: [...ws.pages, {id: 'work', name: '工作', label: '工作', components: [item('e')]}]}, id, 'work')
  assert.deepEqual(cross.pages[0].sections[0].primary, ['b', 'a'])
  assert.deepEqual(ids(cross.pages[1]), ['e', id])
  const uninstalled = apps.removeApplication(ws, id)
  assert.deepEqual(uninstalled.pages[0].sections[0].primary, ['b', 'a'])
  assert.equal(uninstalled.applications.length, 0)
})

test('版本迁移保留旧页面，坏布局只清理引用且模板读取共用规则', () => {
  const store = load('src/lib/workspaceStore.ts')
  const old = {...base(), version: 5}
  const legacy = store.migrate(old)
  assert.equal(legacy.version, load('src/lib/workspace.ts').WORKSPACE_VERSION)
  assert.equal(legacy.pages[0].sections, undefined)
  assert.deepEqual(ids(legacy.pages[0]), ['a', 'b', 'c', 'd'])
  for (const sections of [null, 0, '', {}, []]) {
    const malformed = store.migrate({...old, pages: [{...old.pages[0], sections}]})
    assert.equal(malformed.pages[0].sections, undefined)
    assert.deepEqual(ids(malformed.pages[0]), ['a', 'b', 'c', 'd'])
  }
  const dirty = clone(old)
  dirty.pages[0].components.push({id: 'gone', type: 'unknown', config: {}})
  dirty.pages[0].sections = [
    {id: 'bad', kind: 'unknown', items: ['d']},
    {id: 'h', kind: 'hero', items: ['gone', 'b', 'b', 'foreign']},
    {id: 'h2', kind: 'hero', items: ['d']},
    {id: 'main', kind: 'split', primary: ['c', 'b'], secondary: ['a', 'c']},
    {id: 'empty', kind: 'section', items: ['gone']},
  ]
  const before = clone(dirty), migrated = store.migrate(dirty)
  assert.deepEqual(ids(migrated.pages[0]), ['b', 'c', 'a', 'd'])
  assert.deepEqual(migrated.pages[0].sections.map((section) => section.id), ['h', 'main', 'empty'])
  assert.deepEqual(migrated.pages[0].sections[0].items, ['b'])
  assert.deepEqual(migrated.pages[0].sections[1].primary, ['c'])
  assert.deepEqual(migrated.pages[0].sections[1].secondary, ['a'])
  assert.deepEqual(dirty, before)
  const entries = store.readTemplates([{id: 'mine', name: '我的页面', snapshot: templates.snapshotOf(dirty)}])
  assert.deepEqual(entries[0].snapshot.pages[0].sections, migrated.pages[0].sections)
})

test('自存模板保留身份，内置预设换ID同时重写所有分区引用', () => {
  const ws = ops.setPageSections(base(), 'home', sections())
  const savedTemplate = templates.saveTemplate(ws, {name: '分区首页'})
  const changed = ops.removeComponent(savedTemplate.workspace, 'b').workspace
  const restored = templates.applyTemplate(changed, savedTemplate.template.id).workspace
  assert.deepEqual(restored.pages[0].sections, ws.pages[0].sections)
  assert.deepEqual(ids(restored.pages[0]), ids(ws.pages[0]))
  const catalog = load('src/lib/presets.ts').PRESETS
  const snapshot = templates.snapshotOf(ws)
  catalog.push({id: 'fixture-sections', name: '回归分区预设', description: '', tags: [], build: () => clone(snapshot)})
  try {
    const first = templates.applyTemplate(ws, 'fixture-sections').workspace
    const second = templates.applyTemplate(ws, 'fixture-sections').workspace
    assert.equal(first.pages[0].sections[0].items[0], first.pages[0].components[0].id)
    assert.deepEqual(first.pages[0].sections[1].primary, [first.pages[0].components[1].id])
    assert.deepEqual(first.pages[0].sections[1].secondary, [first.pages[0].components[2].id])
    assert.ok(ids(first.pages[0]).every((id) => !ids(ws.pages[0]).includes(id) && !ids(second.pages[0]).includes(id)))
    assert.deepEqual(snapshot, templates.snapshotOf(ws))
  } finally {catalog.pop()}
})

test('外观还原不清分区，提交与撤销重做保留组件身份及独立数据', () => {
  const store = load('src/lib/workspaceStore.ts')
  const appearance = load('src/lib/appearance.ts')
  const ws = ops.setPageSections(base(), 'home', sections())
  const decorated = {...ws, pages: [{...ws.pages[0], wallpaper: {mode: 'off'}, look: {variant: 'card'}, css: '.x { color: red; }'}]}
  const reset = appearance.resetAppearance(decorated)
  assert.deepEqual(reset.pages[0].sections, ws.pages[0].sections)
  assert.deepEqual(ids(reset.pages[0]), ids(ws.pages[0]))
  storage.setItem('fp.note.a', '保留业务数据')
  store.commit(base())
  const before = store.getWorkspace()
  const next = ops.setPageSections(before, 'home', sections())
  store.commit(next)
  assert.deepEqual(store.getWorkspace().pages[0].sections, ws.pages[0].sections)
  assert.equal(store.undo(), true)
  assert.equal(store.getWorkspace(), before)
  assert.equal(store.redo(), true)
  assert.equal(store.getWorkspace(), next)
  assert.equal(storage.getItem('fp.note.a'), '保留业务数据')
  const persisted = JSON.parse(storage.getItem('fp.workspace'))
  assert.deepEqual(persisted.pages[0].sections, next.pages[0].sections)
  assert.deepEqual(ids(persisted.pages[0]), ['b', 'c', 'a', 'd'])
})

console.log(`页面分区数据回归全部通过：${passed}/${passed}`)
