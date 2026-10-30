/**
 * 历史缺陷探针：基线 27358e2，2026-10-30。
 * 断言当前主题身份缺陷确实存在，不是修复后应保持绿色的回归测试。
 * 执行真实主题/模板读取模块；组件注册、初始工作空间及宿主边界为无副作用替身。
 * 不读写用户存储，不调用网络，不提交状态。
 *
 * 本机命令：
 * /Users/xiaomengdao/.nvm/versions/node/v24.11.0/bin/node .trellis/tasks/10-30-theme-shell-architecture/research/theme-identity-probe.mjs
 */
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
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
  const require = id => {
    if (id === 'react') return {useCallback: fn => fn, useSyncExternalStore() {}}
    assert.ok(id.startsWith('.'), `探针尚未隔离的外部依赖：${id}`)
    return load(path.resolve(path.dirname(file), `${id}.ts`))
  }
  new Function('module', 'exports', 'require', compiled)(module, module.exports, require)
  return module.exports
}

const model = load('src/lib/workspace.ts')
const themes = load('src/lib/themes.ts')
const base = (active = 'switch') => ({
  version: model.WORKSPACE_VERSION,
  pages: [{id: 'home', name: '首页', label: '首页', components: []}],
  statusbar: [], addons: [], widgets: [], network: [], templates: [], applications: [],
  layout: {columns: 12, maxWidth: 1440},
  theme: {active, mode: 'light', base: 'light'},
  themes: themes.readThemes([]),
})

for (const id of ['ios', 'switch', 'win98']) {
  const input = base(id)
  const original = model.activeTheme(input)
  const result = themes.tweakTheme(input, {overrides: {main: '#663399'}})
  const forked = result.forked
  assert.ok(forked)
  assert.equal(result.workspace.theme.active, 'custom-1')
  assert.equal(forked.skin, undefined)
  assert.equal(forked.shell, undefined)
  assert.equal(forked.skinId, undefined)
  assert.equal(forked.shellId, undefined)
  assert.deepEqual(forked.overrides, {main: '#663399'})
  assert.equal(forked.fonts, undefined)
  assert.equal(themes.resolveThemeOverrides(forked, 'light').main, original.light.main)
  assert.notEqual(themes.resolveThemeOverrides(forked, 'light').main, '#663399')
  console.log(JSON.stringify({
    probe: 'builtin_fork_loses_identity',
    before: id,
    after: result.workspace.theme.active,
    fields: Object.keys(forked),
    sharedMain: forked.overrides.main,
    effectiveLightMain: themes.resolveThemeOverrides(forked, 'light').main,
  }))
}

for (const [file, value] of Object.entries({
  'src/lib/ops.ts': {defaultWorkspace: base},
  'src/lib/registry.ts': {getDefinition: () => undefined, normalizeConfig: (_definition, config) => config},
  'src/fx/catalog.ts': {normalizeLayer: () => assert.fail('该探针不应读取特效')},
  'src/lib/pageIcons.ts': {isPageIcon: () => false},
  'src/lib/dock.ts': {readDock: () => undefined},
  'src/lib/market.ts': {ADDONS: []},
})) mocks.set(path.resolve(root, file), value)

const store = load('src/lib/workspaceStore.ts')
const inputTheme = {id: 'my-custom', name: '自定义红', description: '', overrides: {main: '#990000'}}
const templates = store.readTemplates([{
  id: 'template-probe', name: '模板探针',
  snapshot: {
    pages: base().pages, statusbar: [], addons: [], widgets: [], applications: [],
    layout: base().layout, theme: inputTheme,
  },
}])
assert.equal(templates.length, 1)
assert.equal(templates[0].snapshot.theme.id, 'ios')
assert.notEqual(templates[0].snapshot.theme.id, inputTheme.id)
console.log(JSON.stringify({probe: 'template_theme_identity_changed', before: inputTheme.id, after: templates[0].snapshot.theme.id}))
console.log('历史缺陷复现：3 个内置主题派生及 1 个模板主题往返，4/4 已确认。')
