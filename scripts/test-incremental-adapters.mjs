import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

// 纯配置协议使用真实基础 schema；只隔离不会被本测试调用的数据库边界。
const modules = new Map()
function load(path) {
  if (path === 'src/lib/db.ts') return {}
  if (modules.has(path)) return modules.get(path)
  const module = {exports: {}}; modules.set(path, module.exports)
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText
  const require = id => {
    if (!id.startsWith('.')) throw new Error('Unexpected dependency ' + id)
    return load(new URL(id + '.ts', 'file:///' + path).pathname.slice(1))
  }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}
const {projectIncrementalConfig, applyIncrementalConfig, validateIncrementalConfig} = load('src/lib/incrementalConfigSchema.ts')
const workspace = () => ({version: 6, pages: [{id: 'home', name: '首页', label: '首页', components: []}], theme: {active: 'custom', mode: 'dark', base: 'light'}, themes: [{id: 'custom', name: '测试', description: '', overrides: {}, light: {bg: '#fff'}, dark: {bg: '#222'}}], layout: {columns: 12, maxWidth: 1480}, widgets: [], applications: [], statusbar: [], dock: {}, addons: [], templates: [], network: [{host: 'local.example', grantedAt: 1}]})
let passed = 0
function test(name, fn) {fn(); passed++; console.log('通过：' + name)}
test('完整搜索配置保留服务地址和密钥', () => {
  const value = {provider: 'searxng', urls: {searxng: 'https://search.example'}, keys: {searxng: 'secret'}}
  assert.deepEqual(projectIncrementalConfig('search', value), value)
})
test('AI与监测连接字段完整保留', () => {
  const value = {name: 'Dada', proxy: '/proxy?url={url}', monitor: [{id: 'm', name: 'prod', kind: 'coolify', baseUrl: 'https://coolify', token: 'token'}], ai: {model: 'm', baseUrl: 'https://api', apiKey: 'key', extraBody: '{}'}}
  assert.deepEqual(projectIncrementalConfig('settings', value), value)
})
test('工作空间只保留本机 network，不把授权发给另一设备', () => {
  const value = workspace()
  const projected = projectIncrementalConfig('workspace', value)
  assert.equal('network' in projected, false)
  assert.deepEqual(applyIncrementalConfig('workspace', projected, value).network, value.network)
  assert.deepEqual(projected.themes, value.themes)
  assert.equal(projected.theme.mode, 'dark')
})
test('远端完整配置替换会传播密钥删除', () => {
  assert.deepEqual(applyIncrementalConfig('search', {provider: 'off', keys: {}, urls: {}}, {provider: 'tavily', keys: {tavily: 'old'}}), {provider: 'off', keys: {}, urls: {}})
})
test('非法搜索地址和凭据类型拒绝', () => {
  assert.throws(() => validateIncrementalConfig('search', {provider: 'tavily', urls: {tavily: 123}}))
  assert.throws(() => validateIncrementalConfig('search', {provider: 'tavily', keys: 'bad'}))
})
test('完整配置仍拒绝未知业务字段、非法主题和本机授权入站', () => {
  for (const [name, value] of [['settings', {name: 7}], ['settings', {unexpected: true}], ['search', {provider: 'invalid'}], ['alwaysAllow', []], ['workspace', workspace()]]) {
    assert.throws(() => validateIncrementalConfig(name, value))
  }
  const w = projectIncrementalConfig('workspace', workspace()); w.theme.mode = 'invalid'
  assert.throws(() => validateIncrementalConfig('workspace', w))
})
test('稳定偏好可往返且拒绝错误类型，删除保留仅本机授权', () => {
  for (const [name, value] of [['assistantSplitRatio', 0.63], ['playerPrefs', {volume: 0.5, mode: 'shuffle', trackId: 'track'}], ['analytics', false]]) {
    assert.deepEqual(applyIncrementalConfig(name, projectIncrementalConfig(name, value), undefined), value)
    assert.throws(() => validateIncrementalConfig(name, 'invalid'))
  }
  assert.deepEqual(applyIncrementalConfig('workspace', undefined, workspace()), {network: workspace().network})
  assert.equal(projectIncrementalConfig('workspace', {network: workspace().network}), undefined)
  assert.equal(applyIncrementalConfig('settings', undefined, {ai: {apiKey: 'old'}}), undefined)
})
console.log(`增量同步适配器契约通过：${passed} 组`)
